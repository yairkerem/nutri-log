/* חיווט האפליקציה: קלט, הכתבה, השלמת פרטים, יומן וגיבוי. */
(function (global) {
  'use strict';

  var el = UI.el;
  var on = UI.on;
  var DISMISSED_UPDATE_KEY = 'nutrilog.dismissedUpdate';
  var drafts = [];
  var draftSeq = 0;
  var filters = { type: 'all', search: '', range: '7' };
  var voiceBase = '';

  /* ─────────── הפעלה ─────────── */

  /* כל שלב אתחול עומד בפני עצמו: תקלה באחד מהם לא תשאיר את שאר האפליקציה
     בלי חיווט, והשגיאה מדווחת על המסך כדי שאפשר יהיה לאתר אותה גם בטלפון. */
  function step(name, fn) {
    try {
      fn();
    } catch (err) {
      reportError(name, err);
    }
  }

  function init() {
    global.addEventListener('error', function (event) {
      reportError('שגיאה', event.error || new Error(event.message));
    });

    step('טעינת הרשומות', function () { Store.load(); });
    step('חלון העריכה', function () {
      UI.initEditDialog({ onSave: saveEdit, onDelete: deleteRecord, onSplit: splitRecord });
    });
    step('שורת הקלט', wireCapture);
    step('הסינון', wireFilters);
    step('הנתונים', wireData);
    step('התאריך', setTodayLabel);
    step('המיקרופון', setMicAvailability);
    step('היומן', function () {
      Store.onChange(refresh);
      refresh();
    });
    /* אחרי שהדף צויר, כדי לא להתחרות בטעינה הראשונה. */
    setTimeout(checkForUpdateQuietly, 1200);
  }

  var reportedError = false;
  function reportError(where, err) {
    if (global.console && console.error) console.error('Nutri Log / ' + where, err);
    if (reportedError) return;
    reportedError = true;
    var bar = el('updateBar');
    var text = el('updateBarText');
    if (!bar || !text) return;
    text.textContent = 'תקלה ב' + where + ': ' + ((err && err.message) || err);
    bar.classList.add('is-error');
    bar.hidden = false;
    if (el('updateBarBtn')) el('updateBarBtn').hidden = true;
    if (el('updateBarClose')) {
      el('updateBarClose').onclick = function () { bar.hidden = true; };
    }
  }

  function setTodayLabel() {
    var now = new Date();
    var text = UI.heDate(now);
    el('todayLabel').textContent = text;
  }

  function refresh() {
    UI.renderStats(Store.dayStats(new Date()));
    UI.renderWeek(Store.lastDays(7));
    UI.renderLog(Store.query(filters), openEdit);
    UI.renderRecent(Store.recent(5), repeatRecord);
  }

  /* ─────────── קלט ─────────── */

  function wireCapture() {
    on('btnAdd', 'click', function () {
      /* בזמן הכתבה הכפתור מסיים אותה, והניתוח נעשה במסלול הסיום. ניתוח מיידי
         היה מרוקן את התיבה בזמן שהמיקרופון עוד כותב לתוכה, ואז מנתח שוב. */
      if (Speech.isListening()) {
        el('micStatus').classList.remove('is-warn');
        el('micStatus').textContent = 'מסיים ומנתח…';
        Speech.stop();
        return;
      }
      submitInput('text');
    });

    on('entryInput', 'keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitInput('text');
      }
    });

    Array.prototype.forEach.call(document.querySelectorAll('.chip-hint'), function (chip) {
      chip.addEventListener('click', function () {
        el('entryInput').value = chip.dataset.example;
        el('entryInput').focus();
      });
    });

    on('btnMic', 'click', toggleMic);
    on('btnSaveAllDrafts', 'click', saveAllDrafts);
    on('btnClearDrafts', 'click', function () {
      drafts = [];
      renderDrafts();
    });
  }

  function submitInput(source) {
    var input = el('entryInput');
    var text = input.value;
    if (!Parser.normalize(text)) {
      UI.toast('אין מה לנתח — נא לכתוב או להכתיב תיאור.');
      input.focus();
      return;
    }

    var parsed = Parser.parse(text, new Date());
    if (!parsed.length) {
      UI.toast('לא זוהתה רשומה בטקסט הזה.');
      return;
    }

    /* שום דבר לא נשמר ישירות: מה שזוהה עולה לבדיקה, ורק משם נשמר. כך אפשר
       לראות איך התפצל המשפט ולתקן לפני שהוא נכנס ליומן. */
    parsed.forEach(function (rec) {
      rec.source = source;
      draftSeq++;
      rec.key = 'd' + draftSeq;
      drafts.push(rec);
    });

    input.value = '';
    voiceBase = '';
    renderDrafts();

    var missing = parsed.filter(function (rec) { return rec.missing.length; }).length;
    UI.toast(missing
      ? 'זוהו ' + parsed.length + ' רשומות, חסרה כמות ב־' + missing + '.'
      : 'זוהו ' + parsed.length + ' רשומות — אפשר לבדוק ולשמור.');
    el('draftSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function stripDraftFields(rec) {
    var copy = Object.assign({}, rec);
    delete copy.missing;
    delete copy.key;
    delete copy.tsExplicit;
    return copy;
  }

  /* ─────────── הכתבה קולית ─────────── */

  function setMicAvailability() {
    var reason = Speech.unsupportedReason();
    if (reason) {
      el('btnMic').disabled = true;
      el('btnMic').title = reason;
      el('micStatus').textContent = reason;
      el('micStatus').classList.add('is-warn');
    } else {
      el('btnMic').title = 'הכתבה קולית בעברית';
    }
  }

  function toggleMic() {
    if (Speech.isListening()) {
      Speech.stop();
      return;
    }
    voiceBase = el('entryInput').value.trim();
    Speech.start({
      onStart: function () {
        setMicState(true);
        el('micStatus').classList.remove('is-warn');
        el('micStatus').textContent = 'מקשיב… אפשר לדבר, ולחיצה נוספת מסיימת.';
      },
      onProgress: function (spoken) {
        el('entryInput').value = [voiceBase, spoken].filter(Boolean).join(' ');
      },
      onError: function (message) {
        setMicState(false);
        if (message) {
          el('micStatus').textContent = message;
          el('micStatus').classList.add('is-warn');
        }
      },
      onEnd: function (finalText, segments) {
        setMicState(false);
        /* ההפסקות בדיבור הופכות לפסיקים היכן שהן באמת מפרידות בין פריטים,
           ואז מה שהוכתב מנוקה מחזרות. התיבה מציגה את התוצאה לפני השמירה. */
        var text = (segments && segments.length > 1)
          ? Parser.joinSegments(segments)
          : (finalText || '');
        var spoken = Parser.collapseRepeats(text);
        var combined = [voiceBase, spoken].filter(Boolean).join(' ').trim();
        el('entryInput').value = combined;
        Speech.note('app', 'joined=' + JSON.stringify(combined) +
          '  records=' + JSON.stringify(Parser.parse(combined, new Date()).map(function (rec) { return rec.name; })));
        if (finalText) {
          el('micStatus').textContent = '';
          submitInput('voice');
        } else if (!el('micStatus').classList.contains('is-warn')) {
          el('micStatus').textContent = 'לא נשמע דיבור. אפשר לנסות שוב או להקליד.';
        }
      }
    });
  }

  function setMicState(listening) {
    var btn = el('btnMic');
    btn.classList.toggle('is-listening', listening);
    btn.setAttribute('aria-pressed', listening ? 'true' : 'false');
    /* הסמל מתחלף לריבוע עצירה, ולכן גם שם הכפתור מתאר את הפעולה הנוכחית. */
    btn.setAttribute('aria-label', listening ? 'עצירת ההכתבה' : 'הכתבה קולית');
    btn.title = listening ? 'עצירת ההכתבה' : 'הכתבה קולית בעברית';
    /* הכפתור הראשי אומר מה הוא יעשה עכשיו. */
    if (el('btnAdd')) el('btnAdd').textContent = listening ? 'סיום וניתוח' : 'ניתוח';
    if (!listening && el('micStatus').textContent === 'מקשיב… אפשר לדבר, ולחיצה נוספת מסיימת.') {
      el('micStatus').textContent = '';
    }
  }

  /* ─────────── כרטיסי השלמה ─────────── */

  function renderDrafts() {
    UI.renderDrafts(drafts, {
      onChange: changeDraft,
      onSave: saveDraft,
      onDiscard: discardDraft,
      onSplit: splitDraft
    });
  }

  function findDraft(key) {
    for (var i = 0; i < drafts.length; i++) { if (drafts[i].key === key) return drafts[i]; }
    return null;
  }

  function changeDraft(key, patch, silent) {
    var draft = findDraft(key);
    if (!draft) return;
    Object.assign(draft, patch);
    if (patch.type) {
      /* מעבר בין אוכל לאימון: מנקים שדות שלא רלוונטיים. */
      if (patch.type === 'workout') { draft.amount = null; draft.unit = null; draft.meal = null; }
      else { draft.durationMin = null; draft.steps = null; draft.intensity = null; }
    }
    if (draft.type === 'food' && draft.amount != null && !draft.unit) draft.unit = 'unit';
    draft.missing = Parser.missingFields(draft);
    if (!silent) renderDrafts();
  }

  function saveDraft(key, allowMissing) {
    var draft = findDraft(key);
    if (!draft) return;
    if (!draft.name || !draft.name.trim()) {
      UI.toast('נא למלא שם לרשומה.');
      return;
    }
    draft.missing = Parser.missingFields(draft);
    if (draft.missing.length && !allowMissing) {
      UI.toast(draft.type === 'food' ? 'נא להשלים כמות, או לשמור ללא כמות.' : 'נא להשלים דקות או צעדים.');
      return;
    }
    Store.add(stripDraftFields(draft));
    drafts = drafts.filter(function (item) { return item.key !== key; });
    renderDrafts();
    UI.toast('נשמר: ' + draft.name);
  }

  function saveAllDrafts() {
    var remaining = [];
    var saved = 0;
    drafts.forEach(function (draft) {
      draft.missing = Parser.missingFields(draft);
      if (draft.missing.length || !draft.name.trim()) { remaining.push(draft); return; }
      Store.add(stripDraftFields(draft));
      saved++;
    });
    drafts = remaining;
    renderDrafts();
    if (saved && remaining.length) UI.toast('נשמרו ' + saved + '. נשארו ' + remaining.length + ' להשלמה.');
    else if (saved) UI.toast('נשמרו ' + saved + ' רשומות.');
    else UI.toast('כל הרשומות עדיין חסרות פרטים.');
  }

  function discardDraft(key) {
    drafts = drafts.filter(function (item) { return item.key !== key; });
    renderDrafts();
  }

  /* פיצול ארוחה מרובת מרכיבים לרשומה נפרדת לכל מרכיב, כולל פיצול על "עם".
     הכמות המקורית נשארת אצל המרכיב הראשון, והשאר יבקשו כמות משלהם. */
  function splitDraft(key) {
    var draft = findDraft(key);
    if (!draft) return;

    var source = (draft.name || draft.raw || '').trim();
    var parts = Parser.parse(source, new Date(draft.ts), { splitWith: true });
    if (parts.length < 2) {
      UI.toast('אין מה לפצל ברשומה הזו.');
      return;
    }

    var index = drafts.indexOf(draft);
    var replacements = parts.map(function (rec, position) {
      draftSeq++;
      rec.key = 'd' + draftSeq;
      rec.ts = draft.ts;
      rec.tsExplicit = draft.tsExplicit;
      rec.source = draft.source;
      rec.raw = draft.raw;
      if (position === 0 && draft.type === 'food' && rec.type === 'food' && draft.amount != null) {
        rec.amount = draft.amount;
        rec.unit = draft.unit;
      }
      rec.missing = Parser.missingFields(rec);
      return rec;
    });

    drafts.splice.apply(drafts, [index, 1].concat(replacements));
    renderDrafts();
    UI.toast('פוצל ל־' + replacements.length + ' רשומות.');
  }

  /* ─────────── יומן ─────────── */

  function wireFilters() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (other) {
          other.classList.toggle('is-active', other === tab);
          other.setAttribute('aria-selected', other === tab ? 'true' : 'false');
        });
        filters.type = tab.dataset.filter;
        refresh();
      });
    });

    on('searchInput', 'input', function () {
      filters.search = el('searchInput').value;
      refresh();
    });

    on('rangeSelect', 'change', function () {
      filters.range = el('rangeSelect').value;
      refresh();
    });
  }

  function openEdit(id) {
    var rec = Store.get(id);
    if (rec) UI.openEdit(rec);
  }

  function saveEdit(id, patch) {
    Store.update(id, patch);
    UI.toast('הרשומה עודכנה.');
  }

  /* פיצול רשומה שכבר נשמרה: הרשומה המקורית מוחלפת ברשומה לכל מרכיב, באותה
     חותמת זמן. הכמות נשארת אצל המרכיב הראשון, אלא אם מרכיב נושא כמות משלו. */
  function splitRecord(id, patch) {
    var existing = Store.get(id);
    if (!existing) return;

    var base = Object.assign({}, existing, patch || {});
    var parts = Parser.parse(base.name, new Date(base.ts), { splitWith: true });
    if (parts.length < 2) {
      UI.toast('אין מה לפצל ברשומה הזו.');
      return;
    }

    var created = parts.map(function (part, position) {
      var out = {
        type: part.type,
        name: part.name,
        ts: base.ts,
        note: base.note,
        raw: base.raw,
        source: base.source
      };
      if (part.type === 'food') {
        out.meal = base.meal;
        out.amount = part.amount;
        out.unit = part.unit;
        if (position === 0) {
          if (out.amount == null && base.amount != null) {
            out.amount = base.amount;
            out.unit = base.unit;
          }
          out.calories = base.calories;
        }
      } else {
        out.durationMin = part.durationMin;
        out.steps = part.steps;
        out.intensity = part.intensity;
      }
      return out;
    });

    Store.addMany(created);
    Store.remove(id);

    var incomplete = created.filter(function (rec) {
      return rec.type === 'food' && rec.amount == null;
    }).length;
    UI.toast(incomplete
      ? 'פוצל ל־' + created.length + ' רשומות. חסרה כמות ב־' + incomplete + '.'
      : 'פוצל ל־' + created.length + ' רשומות.');
  }

  function deleteRecord(id) {
    var rec = Store.get(id);
    if (!rec) return;
    if (!global.confirm('למחוק את "' + rec.name + '"?')) return;
    Store.remove(id);
    UI.toast('הרשומה נמחקה.');
  }

  function repeatRecord(id) {
    var rec = Store.get(id);
    if (!rec) return;
    var copy = Object.assign({}, rec);
    delete copy.id;
    delete copy.createdAt;
    copy.ts = new Date().toISOString();
    copy.source = 'repeat';
    Store.add(copy);
    UI.toast('תועד שוב: ' + rec.name);
  }

  /* ─────────── נתונים וגיבוי ─────────── */

  function wireData() {
    on('btnData', 'click', function () {
      var records = Store.all();
      var oldest = records.length ? UI.heDateShort(records[records.length - 1].ts) : null;
      el('dataStats').textContent = records.length
        ? 'סך הכול ' + records.length + ' רשומות, החל מ־' + oldest + '.'
        : 'אין עדיין רשומות.';
      prefillCustomRange();
      updateExportSummary();
      showVersion();
      if (el('speechLog')) {
        el('speechLog').value = Speech.log() || 'אין עדיין יומן. אחרי הכתבה אחת הוא יופיע כאן.';
      }
      UI.openDialog(el('dataDialog'));
    });

    on('btnUpdate', 'click', checkForUpdate);

    /* מה שנשמר באמת ברשומה, כולל מה שהמסך מציג ממנה — כשמשהו נראה חסר, זו
       הדרך לראות אם הוא חסר בנתון או רק בתצוגה. */
    on('btnCopyRecords', 'click', function () {
      var recent = Store.all().slice(0, 3).map(function (rec) {
        var copy = Object.assign({}, rec);
        copy['*מוצג*'] = UI.quantityText(rec);
        return copy;
      });
      el('speechLog').value = recent.length
        ? JSON.stringify(recent, null, 1)
        : 'אין רשומות.';
      UI.toast('הרשומות בתיבה — אפשר להעתיק.');
    });

    on('btnCopyLog', 'click', function () {
      var box = el('speechLog');
      box.removeAttribute('readonly');
      box.focus();
      box.setSelectionRange(0, box.value.length);
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (err) { copied = false; }
      box.setAttribute('readonly', '');
      if (!copied && global.navigator.clipboard) {
        global.navigator.clipboard.writeText(box.value).then(function () {
          UI.toast('היומן הועתק.');
        }, function () {
          UI.toast('לא הצלחתי להעתיק — אפשר לסמן ולהעתיק ידנית.');
        });
        return;
      }
      UI.toast(copied ? 'היומן הועתק.' : 'לא הצלחתי להעתיק — אפשר לסמן ולהעתיק ידנית.');
    });

    on('dataClose', 'click', function () { UI.closeDialog(el('dataDialog')); });

    on('exportRange', 'change', function () {
      el('customRange').hidden = el('exportRange').value !== 'custom';
      updateExportSummary();
    });
    on('exportFrom', 'change', updateExportSummary);
    on('exportTo', 'change', updateExportSummary);

    on('btnShare', 'click', shareSelection);

    on('btnExportCsv', 'click', function () {
      var selection = exportSelection();
      if (!selection.records.length) { UI.toast('אין רשומות בטווח הזה.'); return; }
      download(Store.toCsv(selection.records), exportName(selection, 'csv'), 'text/csv;charset=utf-8');
    });

    on('btnExportJson', 'click', function () {
      download(Store.toJson(), 'nutri-log-backup-' + stamp() + '.json', 'application/json');
    });

    on('importFile', 'change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var count = Store.fromJson(String(reader.result));
          UI.toast(count ? 'יובאו ' + count + ' רשומות.' : 'לא נוספו רשומות חדשות.');
          updateExportSummary();
        } catch (err) {
          UI.toast('הייבוא נכשל: קובץ לא תקין.');
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    });

    on('btnWipe', 'click', function () {
      if (!global.confirm('למחוק את כל הרשומות? הפעולה אינה ניתנת לשחזור.')) return;
      Store.wipe();
      UI.closeDialog(el('dataDialog'));
      UI.toast('כל הרשומות נמחקו.');
    });
  }

  /* ─────────── בחירת טווח לייצוא ולשיתוף ─────────── */

  function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function prefillCustomRange() {
    if (!el('exportTo').value) el('exportTo').value = UI.dateInputValue(new Date());
    if (!el('exportFrom').value) {
      var from = startOfToday();
      from.setDate(from.getDate() - 13);
      el('exportFrom').value = UI.dateInputValue(from);
    }
  }

  /* DD/MM/YYYY, כמו בכל שאר השדות. */
  function dateFromInput(value) {
    return UI.combineDateTime(value, '00:00', new Date());
  }

  function exportSelection() {
    var value = el('exportRange').value;
    if (value === 'all') {
      return { records: Store.all(), from: null, to: null, invalid: false };
    }
    if (value === 'custom') {
      var from = dateFromInput(el('exportFrom').value);
      var to = dateFromInput(el('exportTo').value);
      if (from && to && from > to) return { records: [], from: from, to: to, invalid: true };
      return { records: Store.inRange(from, to), from: from, to: to, invalid: false };
    }
    var days = parseInt(value, 10);
    var start = startOfToday();
    start.setDate(start.getDate() - (days - 1));
    return { records: Store.inRange(start, new Date()), from: start, to: new Date(), invalid: false };
  }

  /* בטקסט מוצג תאריך עברי קצר ומבודד כיוונית; בשם הקובץ נשאר ISO, כדי
     שקבצים יסתדרו לפי סדר. */
  function shortDate(date) {
    return UI.heDateShort(date);
  }

  function rangeText(selection) {
    if (selection.from && selection.to) return 'מ־' + shortDate(selection.from) + ' עד ' + shortDate(selection.to);
    if (selection.from) return 'מ־' + shortDate(selection.from) + ' ואילך';
    if (selection.to) return 'עד ' + shortDate(selection.to);
    return 'כל הרשומות';
  }

  function updateExportSummary() {
    var selection = exportSelection();
    var note = el('exportCount');

    if (selection.invalid) {
      note.textContent = 'תאריך ההתחלה מאוחר מתאריך הסיום.';
    } else if (!selection.records.length) {
      note.textContent = 'אין רשומות בטווח הזה.';
    } else {
      note.textContent = selection.records.length + ' רשומות · ' + rangeText(selection);
    }

    var usable = !selection.invalid && selection.records.length > 0;
    el('btnExportCsv').disabled = !usable;
    el('btnShare').disabled = !usable || !canShareFiles();
    el('shareNote').textContent = canShareFiles()
      ? 'שיתוף פותח את תפריט השיתוף של המכשיר — ווטסאפ, מייל או כל יישום אחר.'
      : 'הדפדפן הזה לא תומך בשיתוף קבצים ישירות. אפשר לייצא CSV ולצרף אותו להודעה.';
  }

  /* בדיקה אחת לדפדפן: האם אפשר לשתף קובץ דרך תפריט השיתוף של המכשיר. */
  var shareSupport = null;
  function canShareFiles() {
    if (shareSupport !== null) return shareSupport;
    try {
      var probe = new File(['test'], 'test.csv', { type: 'text/csv' });
      shareSupport = !!(global.navigator.share && global.navigator.canShare &&
        global.navigator.canShare({ files: [probe] }));
    } catch (err) {
      shareSupport = false;
    }
    return shareSupport;
  }

  function shareSelection() {
    var selection = exportSelection();
    if (!selection.records.length) { UI.toast('אין רשומות בטווח הזה.'); return; }

    var filename = exportName(selection, 'csv');
    var csv = Store.toCsv(selection.records);

    if (!canShareFiles()) {
      download(csv, filename, 'text/csv;charset=utf-8');
      UI.toast('הדפדפן לא תומך בשיתוף ישיר — הקובץ ירד ואפשר לצרף אותו.');
      return;
    }

    var file = new File([csv], filename, { type: 'text/csv' });
    global.navigator.share({
      files: [file],
      title: 'Nutri Log',
      text: 'רשומות מ-Nutri Log, ' + rangeText(selection) + '.'
    }).then(function () {
      UI.toast('הקובץ שותף.');
    }).catch(function (err) {
      /* סגירת תפריט השיתוף אינה שגיאה. */
      if (err && err.name === 'AbortError') return;
      download(csv, filename, 'text/csv;charset=utf-8');
      UI.toast('השיתוף לא הושלם — הקובץ ירד למכשיר.');
    });
  }

  function exportName(selection, extension) {
    if (selection.from || selection.to) {
      var from = selection.from ? Store.localDate(selection.from) : 'start';
      var to = Store.localDate(selection.to || new Date());
      return 'nutri-log-' + from + '_' + to + '.' + extension;
    }
    return 'nutri-log-all-' + stamp() + '.' + extension;
  }

  /* ─────────── בדיקת עדכון ─────────── */

  /* מספר הגרסה הוא ה-?v= שבו נטענים קובצי ה-CSS וה-JS, ולכן אין כאן מקור
     אמת שני שעלול להישאר מאחור. */
  function currentVersion() {
    var link = document.querySelector('link[rel=stylesheet]');
    var match = (link && link.getAttribute('href') || '').match(/v=(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  function showVersion() {
    el('versionNote').textContent = 'גרסה ' + currentVersion() + ' פועלת כעת. ' + browserSupport();
    if (el('btnUpdate')) el('btnUpdate').disabled = false;
  }

  /* שורת אבחון קצרה: בטלפון אין קונסולה, וזה מה שמסביר תקלות בדפדפנים ישנים. */
  function browserSupport() {
    var dialog = typeof document.createElement('dialog').showModal === 'function';
    var lookbehind = true;
    try { new RegExp('(?<!a)b'); } catch (err) { lookbehind = false; }
    var speech = Speech.isSupported();
    function mark(ok) { return ok ? '✓' : '✗'; }
    return 'תמיכת הדפדפן: חלונות ' + mark(dialog) +
      ' · ניתוח טקסט ' + mark(lookbehind) +
      ' · הכתבה ' + mark(speech) + '.';
  }

  function fetchLatestVersion() {
    return global.fetch('index.html?u=' + Date.now(), { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('status ' + response.status);
        return response.text();
      })
      .then(function (html) {
        var match = html.match(/css\/style\.css\?v=(\d+)/);
        if (!match) throw new Error('version not found');
        return parseInt(match[1], 10);
      });
  }

  /* כתובת חדשה מכריחה את הדפדפן להביא את הדף מחדש ולא מהמטמון. */
  function reloadFresh() {
    global.location.replace(global.location.pathname + '?u=' + Date.now());
  }

  function checkForUpdate() {
    var note = el('versionNote');
    el('btnUpdate').disabled = true;
    note.textContent = 'בודק…';

    fetchLatestVersion()
      .then(function (latest) {
        if (latest > currentVersion()) {
          note.textContent = 'נמצאה גרסה חדשה (' + latest + '). טוען אותה…';
          setTimeout(reloadFresh, 700);
          return;
        }
        note.textContent = 'גרסה ' + currentVersion() + ' היא העדכנית ביותר.';
        el('btnUpdate').disabled = false;
      })
      .catch(function () {
        note.textContent = 'לא הצלחתי לבדוק עדכון. צריך חיבור לאינטרנט, ועדכון שפורסם זה עתה עשוי להופיע רק כעבור כעשר דקות.';
        el('btnUpdate').disabled = false;
      });
  }

  /* בדיקה שקטה בהפעלה: אם יש גרסה חדשה מופיע פס עדכון, וכישלון לא מטריד. */
  function checkForUpdateQuietly() {
    fetchLatestVersion().then(function (latest) {
      if (latest <= currentVersion() || latest <= dismissedVersion()) return;
      showUpdateBar(latest);
    }).catch(function () { /* אין חיבור, או פתיחה מקובץ מקומי */ });
  }

  function dismissedVersion() {
    try {
      return parseInt(global.localStorage.getItem(DISMISSED_UPDATE_KEY), 10) || 0;
    } catch (err) {
      return 0;
    }
  }

  function showUpdateBar(latest) {
    el('updateBarText').textContent = 'יש גרסה חדשה של Nutri Log (' + latest + ').';
    el('updateBar').hidden = false;
    el('updateBarBtn').onclick = reloadFresh;
    el('updateBarClose').onclick = function () {
      el('updateBar').hidden = true;
      /* לא מציקים שוב על אותה גרסה. */
      try { global.localStorage.setItem(DISMISSED_UPDATE_KEY, String(latest)); } catch (err) { /* nothing to do */ }
    };
  }

  function stamp() {
    var d = new Date();
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function download(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    UI.toast('הקובץ ' + filename + ' הורד.');
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
