/* חיווט האפליקציה: קלט, הכתבה, השלמת פרטים, יומן וגיבוי. */
(function (global) {
  'use strict';

  var el = UI.el;
  var drafts = [];
  var draftSeq = 0;
  var filters = { type: 'all', search: '', range: '7' };
  var voiceBase = '';

  /* ─────────── הפעלה ─────────── */

  function init() {
    Store.load();
    UI.initEditDialog({ onSave: saveEdit, onDelete: deleteRecord });
    wireCapture();
    wireFilters();
    wireData();
    setTodayLabel();
    setMicAvailability();
    Store.onChange(refresh);
    refresh();
  }

  function setTodayLabel() {
    var now = new Date();
    var text = now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
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
    el('btnAdd').addEventListener('click', function () { submitInput('text'); });

    el('entryInput').addEventListener('keydown', function (event) {
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

    el('btnMic').addEventListener('click', toggleMic);
    el('btnSaveAllDrafts').addEventListener('click', saveAllDrafts);
    el('btnClearDrafts').addEventListener('click', function () {
      drafts = [];
      renderDrafts();
    });
  }

  function submitInput(source) {
    var input = el('entryInput');
    var text = input.value;
    if (!Parser.normalize(text)) {
      UI.toast('אין מה לשמור — נא לכתוב או להכתיב תיאור.');
      input.focus();
      return;
    }

    var parsed = Parser.parse(text, new Date());
    if (!parsed.length) {
      UI.toast('לא זוהתה רשומה בטקסט הזה.');
      return;
    }

    var ready = [];
    var pending = [];
    parsed.forEach(function (rec) {
      rec.source = source;
      if (rec.missing.length) pending.push(rec);
      else ready.push(rec);
    });

    if (ready.length) {
      Store.addMany(ready.map(stripDraftFields));
    }

    pending.forEach(function (rec) {
      draftSeq++;
      rec.key = 'd' + draftSeq;
      drafts.push(rec);
    });

    input.value = '';
    voiceBase = '';
    renderDrafts();

    if (ready.length && !pending.length) {
      UI.toast(ready.length === 1 ? 'נשמר: ' + ready[0].name : 'נשמרו ' + ready.length + ' רשומות.');
    } else if (ready.length && pending.length) {
      UI.toast('נשמרו ' + ready.length + ' רשומות. חסרים פרטים ב־' + pending.length + '.');
    } else {
      UI.toast('חסרים פרטים — נא להשלים למטה.');
      el('draftSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
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
      onProgress: function (finalText, interim) {
        var joined = [voiceBase, finalText, interim].filter(Boolean).join(' ');
        el('entryInput').value = joined;
      },
      onError: function (message) {
        setMicState(false);
        if (message) {
          el('micStatus').textContent = message;
          el('micStatus').classList.add('is-warn');
        }
      },
      onEnd: function (finalText) {
        setMicState(false);
        var combined = [voiceBase, finalText].filter(Boolean).join(' ').trim();
        el('entryInput').value = combined;
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
    if (!listening && el('micStatus').textContent === 'מקשיב… אפשר לדבר, ולחיצה נוספת מסיימת.') {
      el('micStatus').textContent = '';
    }
  }

  /* ─────────── כרטיסי השלמה ─────────── */

  function renderDrafts() {
    UI.renderDrafts(drafts, {
      onChange: changeDraft,
      onSave: saveDraft,
      onDiscard: discardDraft
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
      else { draft.durationMin = null; draft.distanceKm = null; draft.steps = null; draft.sets = null; draft.reps = null; draft.intensity = null; }
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
      UI.toast(draft.type === 'food' ? 'נא להשלים כמות, או לשמור ללא כמות.' : 'נא להשלים דקות, מרחק או חזרות.');
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

    el('searchInput').addEventListener('input', function () {
      filters.search = el('searchInput').value;
      refresh();
    });

    el('rangeSelect').addEventListener('change', function () {
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
    el('btnData').addEventListener('click', function () {
      var records = Store.all();
      var oldest = records.length ? Store.localDate(records[records.length - 1].ts) : null;
      el('dataStats').textContent = records.length
        ? 'סך הכול ' + records.length + ' רשומות, החל מ־' + oldest + '.'
        : 'אין עדיין רשומות.';
      UI.openDialog(el('dataDialog'));
    });

    el('dataClose').addEventListener('click', function () { UI.closeDialog(el('dataDialog')); });

    el('btnExportCsv').addEventListener('click', function () {
      download(Store.toCsv(), 'diet-diary-' + stamp() + '.csv', 'text/csv;charset=utf-8');
    });

    el('btnExportJson').addEventListener('click', function () {
      download(Store.toJson(), 'diet-diary-' + stamp() + '.json', 'application/json');
    });

    el('importFile').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var count = Store.fromJson(String(reader.result));
          UI.toast(count ? 'יובאו ' + count + ' רשומות.' : 'לא נוספו רשומות חדשות.');
        } catch (err) {
          UI.toast('הייבוא נכשל: קובץ לא תקין.');
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    });

    el('btnWipe').addEventListener('click', function () {
      if (!global.confirm('למחוק את כל הרשומות? הפעולה אינה ניתנת לשחזור.')) return;
      Store.wipe();
      UI.closeDialog(el('dataDialog'));
      UI.toast('כל הרשומות נמחקו.');
    });
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
