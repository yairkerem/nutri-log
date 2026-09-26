/* בניית התצוגה: יומן, סיכום, כרטיסי השלמה ודיאלוגים. */
(function (global) {
  'use strict';

  var L = global.Lexicon;

  function el(id) { return document.getElementById(id); }

  /* חיווט סובלני: אלמנט חסר (למשל דף ישן שנשאר במטמון לצד קוד חדש) מדלג על
     התכונה הזו בלבד, במקום להפיל את כל האתחול. */
  function on(id, type, handler) {
    var node = el(id);
    if (!node) {
      if (global.console && console.warn) console.warn('Nutri Log: חסר אלמנט #' + id);
      return false;
    }
    node.addEventListener(type, handler);
    return true;
  }

  function h(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        if (key === 'class') node.className = props[key];
        else if (key === 'text') node.textContent = props[key];
        else if (key === 'dataset') Object.assign(node.dataset, props[key]);
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2).toLowerCase(), props[key]);
        else if (props[key] !== null && props[key] !== undefined) node.setAttribute(key, props[key]);
      });
    }
    (children || []).forEach(function (child) {
      if (child == null) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  /* ─────────── עזרי תצוגה ─────────── */

  function formatNum(n) {
    if (n == null) return '';
    var rounded = Math.round(n * 100) / 100;
    return String(rounded);
  }

  function unitLabel(rec) { return global.Store.labels.unit(rec); }

  /* סוף האימון מחושב מההתחלה ומהמשך ולא נקרא מהשדה השמור: רשומות שנשמרו לפני
     שהשדה היה קיים לא מכילות אותו, ובלי החישוב הן היו מוצגות בלי שעת סיום. */
  function endOf(rec) {
    if (!rec || rec.type !== 'workout' || !rec.durationMin) return null;
    return new Date(new Date(rec.ts).getTime() + rec.durationMin * 60000);
  }

  function quantityText(rec) {
    var parts = [];
    if (rec.type === 'food') {
      if (rec.amount != null) parts.push(formatNum(rec.amount) + (unitLabel(rec) ? ' ' + unitLabel(rec) : ''));
      if (rec.calories != null) parts.push(formatNum(rec.calories) + ' קלוריות');
    } else {
      /* אימון הוא פרק זמן: מוצג מתי התחיל ומתי נגמר. */
      var ends = endOf(rec);
      if (ends) parts.push(heTime(rec.ts) + "–" + heTime(ends));
      if (rec.durationMin != null) parts.push(formatNum(rec.durationMin) + ' דקות');
      if (rec.steps != null) parts.push(rec.steps.toLocaleString('he-IL') + ' צעדים');
      var intensity = global.Store.labels.intensity(rec);
      if (intensity) parts.push('עצימות ' + intensity);
    }
    return parts.join(' · ');
  }

  var WEEKDAYS_LONG = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];
  var WEEKDAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  /* בידוד כיווני. מקף או נקודתיים בין מספרים הם תווים ניטרליים, ובשורה עברית
     הם מקבלים את כיוון הפסקה — כך ש-"16:30" נקרא הפוך. מה שנמצא בין שני
     הסימנים האלה שומר על הסדר שלו עצמו. */
  var LRI = '⁦';
  var PDI = '⁩';

  function ltr(text) { return text ? LRI + text + PDI : text; }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /* תאריך מספרי מבודד, תמיד DD/MM/YYYY: 26/09/2026 */
  function heDateShort(value) {
    return ltr(dateInputValue(value));
  }

  /* הערכים שבשדות. שדות date ו-time של הדפדפן מוצגים לפי שפת המכשיר — בטלפון
     באנגלית זה MM/DD/YYYY ושעון 12 שעות — ולכן השדות כאן הם טקסט, והתבנית
     קבועה: DD/MM/YYYY ו-24 שעות. */
  function dateInputValue(value) {
    var d = new Date(value);
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function timeInputValue(value) {
    var d = new Date(value);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* היום בשבוע הוא מה שאנשים באמת בודקים מול תאריך. */
  function heDate(value) {
    var d = new Date(value);
    return WEEKDAYS_LONG[d.getDay()] + ', ' + heDateShort(d);
  }

  function heTime(value) {
    var d = new Date(value);
    return ltr(pad2(d.getHours()) + ':' + pad2(d.getMinutes()));
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function dayHeading(date) {
    var today = new Date();
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    var label = heDate(date);
    if (sameDay(date, today)) return 'היום · ' + label;
    if (sameDay(date, yesterday)) return 'אתמול · ' + label;
    return label;
  }

  function timeText(ts) { return heTime(ts); }

  /* ─────────── תפריטי בחירה ─────────── */

  function fillSelect(select, options, placeholder) {
    select.textContent = '';
    if (placeholder != null) select.appendChild(h('option', { value: '', text: placeholder }));
    options.forEach(function (opt) {
      select.appendChild(h('option', { value: opt.value, text: opt.label }));
    });
  }

  function unitOptions() {
    return L.UNITS.map(function (unit) { return { value: unit.key, label: unit.plural }; });
  }

  function mealOptions() {
    return L.MEALS.map(function (meal) { return { value: meal.key, label: meal.label }; });
  }

  function intensityOptions() {
    return L.INTENSITIES.map(function (it) { return { value: it.key, label: it.label }; });
  }

  /* ─────────── סיכום ─────────── */

  function renderStats(stats) {
    el('statFood').textContent = stats.food;
    el('statWorkout').textContent = stats.workout;
    el('statMinutes').textContent = stats.minutes;
    el('statSteps').textContent = stats.steps ? stats.steps.toLocaleString('he-IL') : '0';
  }

  function renderWeek(days) {
    var max = days.reduce(function (acc, day) { return Math.max(acc, day.stats.minutes); }, 0);
    var wrap = el('weekBars');
    wrap.textContent = '';
    days.forEach(function (day) {
      var height = max > 0 ? Math.max(3, Math.round(day.stats.minutes / max * 100)) : 3;
      var bar = h('div', { class: 'bar' + (day.stats.minutes ? ' has-value' : '') }, [
        h('span', { class: 'bar-fill', style: 'height:' + height + '%' }),
        h('span', { class: 'bar-label', text: WEEKDAYS_SHORT[day.date.getDay()] })
      ]);
      bar.title = day.stats.minutes + ' דקות';
      wrap.appendChild(bar);
    });
  }

  /* ─────────── יומן ─────────── */

  function renderLog(records, onEdit) {
    var list = el('logList');
    list.textContent = '';
    el('logCount').textContent = records.length ? records.length + ' רשומות' : '';
    el('logEmpty').hidden = records.length > 0;

    var currentKey = null;
    records.forEach(function (rec) {
      var date = new Date(rec.ts);
      var key = date.toDateString();
      if (key !== currentKey) {
        currentKey = key;
        list.appendChild(h('h3', { class: 'day-head', text: dayHeading(date) }));
      }

      var meal = global.Store.labels.meal(rec);
      var quantity = quantityText(rec);
      var details = [];
      if (quantity) details.push(quantity);
      if (rec.type === 'food' && meal) details.push('ארוחת ' + meal);
      if (rec.note) details.push(rec.note);

      var item = h('button', {
        class: 'entry entry-' + rec.type,
        type: 'button',
        'aria-label': 'עריכת ' + rec.name,
        onclick: function () { onEdit(rec.id); }
      }, [
        h('span', { class: 'entry-time', text: timeText(rec.ts) }),
        h('span', { class: 'entry-icon', 'aria-hidden': 'true', text: rec.type === 'food' ? '🍽️' : '🏃' }),
        h('span', { class: 'entry-body' }, [
          h('span', { class: 'entry-name', text: rec.name }),
          details.length ? h('span', { class: 'entry-meta', text: details.join(' · ') }) : null
        ]),
        h('span', { class: 'entry-edit', 'aria-hidden': 'true', text: '✎' })
      ]);
      list.appendChild(item);
    });
  }

  /* ─────────── פריטים אחרונים ─────────── */

  function renderRecent(records, onPick) {
    var wrap = el('recentWrap');
    var holder = el('recentChips');
    holder.textContent = '';
    if (!records.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    records.forEach(function (rec) {
      var quantity = quantityText(rec);
      holder.appendChild(h('button', {
        class: 'chip',
        type: 'button',
        title: 'תיעוד שוב, עם חותמת הזמן הנוכחית',
        onclick: function () { onPick(rec.id); }
      }, [(rec.type === 'food' ? '🍽️ ' : '🏃 ') + rec.name + (quantity ? ' · ' + quantity : '')]));
    });
  }

  /* ─────────── כרטיסי השלמה ─────────── */

  function renderDrafts(drafts, actions) {
    var section = el('draftSection');
    var list = el('draftList');
    list.textContent = '';
    section.hidden = drafts.length === 0;
    el('draftCount').textContent = drafts.length ? drafts.length + ' ממתינות' : '';
    if (!drafts.length) return;

    var firstMissing = null;

    drafts.forEach(function (draft) {
      var needsAmount = draft.type === 'food' && draft.amount == null;
      var needsEffort = draft.type === 'workout' &&
        draft.durationMin == null && draft.steps == null;

      var card = h('div', { class: 'draft' + (needsAmount || needsEffort ? ' is-missing' : ''), dataset: { id: draft.key } });

      /* שורת סוג ושם */
      var typeToggle = h('div', { class: 'type-toggle', role: 'group', 'aria-label': 'סוג הרשומה' }, [
        h('button', {
          class: 'type-btn' + (draft.type === 'food' ? ' is-active' : ''), type: 'button',
          onclick: function () { actions.onChange(draft.key, { type: 'food' }); }
        }, ['אוכל']),
        h('button', {
          class: 'type-btn' + (draft.type === 'workout' ? ' is-active' : ''), type: 'button',
          onclick: function () { actions.onChange(draft.key, { type: 'workout' }); }
        }, ['אימון'])
      ]);

      var nameInput = h('input', { class: 'draft-name', type: 'text', value: draft.name, 'aria-label': 'שם' });
      nameInput.addEventListener('change', function () { actions.onChange(draft.key, { name: nameInput.value }, true); });

      card.appendChild(h('div', { class: 'draft-top' }, [typeToggle, nameInput]));

      if (needsAmount) {
        card.appendChild(h('p', { class: 'draft-ask', text: 'כמה ' + (draft.name || 'זה') + '? נא להשלים את הכמות.' }));
      } else if (needsEffort) {
        card.appendChild(h('p', { class: 'draft-ask', text: 'כמה זמן נמשך האימון? אפשר גם לרשום צעדים.' }));
      }

      /* שורת כמות */
      var fields = h('div', { class: 'draft-fields' });

      if (draft.type === 'food') {
        var amountInput = h('input', {
          class: 'num' + (needsAmount ? ' needs' : ''), type: 'number', step: 'any', min: '0',
          inputmode: 'decimal', placeholder: 'כמות', 'aria-label': 'כמות',
          value: draft.amount != null ? draft.amount : ''
        });
        amountInput.addEventListener('input', function () {
          actions.onChange(draft.key, { amount: amountInput.value === '' ? null : parseFloat(amountInput.value) }, true);
        });
        if (needsAmount && !firstMissing) firstMissing = amountInput;

        var unitSelect = h('select', { class: 'unit', 'aria-label': 'יחידה' });
        fillSelect(unitSelect, unitOptions());
        unitSelect.value = draft.unit || 'unit';
        unitSelect.addEventListener('change', function () {
          /* לא שקט: החלפת יחידה מרעננת גם את קיצורי הכמות. */
          actions.onChange(draft.key, { unit: unitSelect.value });
        });

        fields.appendChild(h('label', { class: 'field-inline' }, [amountInput, unitSelect]));

        var quick = h('div', { class: 'quick' });
        quickAmounts(draft.unit || 'unit').forEach(function (value) {
          quick.appendChild(h('button', {
            class: 'chip chip-mini', type: 'button',
            onclick: function () { actions.onChange(draft.key, { amount: value }); }
          }, [formatNum(value)]));
        });
        fields.appendChild(quick);
      } else {
        /* שעת הסיום נגזרת מההתחלה ומהמשך, ומתעדכנת בזמן ההקלדה — אימון הוא
           פרק זמן, ולראות רק את תחילתו אינו מספיק כדי לאשר אותו. */
        var endLabel = h('span', { class: 'draft-end' });
        var updateEnd = function () {
          var start = new Date(draft.ts);
          endLabel.textContent = draft.durationMin
            ? 'עד ' + heTime(new Date(start.getTime() + draft.durationMin * 60000))
            : '';
        };

        fields.appendChild(numField('דקות', draft.durationMin, needsEffort, function (value) {
          actions.onChange(draft.key, { durationMin: value }, true);
          updateEnd();
        }, function (input) { if (needsEffort && !firstMissing) firstMissing = input; }));

        updateEnd();
        fields.appendChild(endLabel);
      }

      card.appendChild(fields);

      /* שורת זמן */
      var date = new Date(draft.ts);
      var dateInput = h('input', { class: 'date', type: 'text', inputmode: 'numeric', maxlength: '10', value: dateInputValue(draft.ts), 'aria-label': 'תאריך', placeholder: 'DD/MM/YYYY' });
      var timeInput = h('input', { class: 'time', type: 'text', inputmode: 'numeric', maxlength: '5', value: timeInputValue(draft.ts), 'aria-label': 'שעה', placeholder: 'HH:MM' });
      function pushTime() {
        var next = combineDateTime(dateInput.value, timeInput.value, date);
        if (!next) return;
        actions.onChange(draft.key, { ts: next.toISOString() }, true);
        if (draft.type === 'workout') renderDrafts(drafts, actions);
      }
      dateInput.addEventListener('change', pushTime);
      timeInput.addEventListener('change', pushTime);

      card.appendChild(h('div', { class: 'draft-time' }, [
        h('span', {
          class: 'draft-time-label',
          text: draft.type === 'workout'
            ? 'תחילת האימון:'
            : (draft.tsExplicit ? 'זמן מהטקסט:' : 'זמן התיעוד:')
        }),
        timeInput, dateInput
      ]));

      if (draft.raw) card.appendChild(h('p', { class: 'raw-line', text: '"' + draft.raw + '"' }));

      var buttons = [
        h('button', {
          class: 'primary-btn small', type: 'button',
          onclick: function () { actions.onSave(draft.key); }
        }, ['שמירה'])
      ];
      if (needsAmount || needsEffort) {
        buttons.push(h('button', {
          class: 'ghost-btn small', type: 'button',
          onclick: function () { actions.onSave(draft.key, true); }
        }, ['שמירה ללא כמות']));
      }

      /* "קפה עם חלב" נשמר כפריט אחד, אבל אפשר לבקש לפצל גם אותו. */
      if (canSplitDraft(draft)) {
        buttons.push(h('button', {
          class: 'ghost-btn small', type: 'button',
          title: 'פיצול לרשומה נפרדת לכל מרכיב',
          onclick: function () { actions.onSplit(draft.key); }
        }, ['פיצול']));
      }
      buttons.push(h('button', {
        class: 'danger-btn small', type: 'button',
        onclick: function () { actions.onDiscard(draft.key); }
      }, ['הסרה']));

      card.appendChild(h('div', { class: 'draft-actions' }, buttons));
      list.appendChild(card);
    });

    if (firstMissing) firstMissing.focus({ preventScroll: true });
  }

  function canSplitDraft(draft) {
    var source = (draft.name || draft.raw || '').trim();
    if (!source) return false;
    return global.Parser.parse(source, new Date(draft.ts), { splitWith: true }).length > 1;
  }

  function numField(label, value, needs, onInput, onCreate) {
    var input = h('input', {
      class: 'num' + (needs ? ' needs' : ''), type: 'number', step: 'any', min: '0',
      inputmode: 'decimal', 'aria-label': label, value: value != null ? value : ''
    });
    input.addEventListener('input', function () {
      onInput(input.value === '' ? null : parseFloat(input.value));
    });
    if (onCreate) onCreate(input);
    return h('label', { class: 'field-inline' }, [h('span', { class: 'inline-label', text: label }), input]);
  }

  function quickAmounts(unitKey) {
    if (unitKey === 'g') return [30, 50, 100, 150, 200];
    if (unitKey === 'ml') return [100, 200, 250, 330, 500];
    if (unitKey === 'kg' || unitKey === 'l') return [0.25, 0.5, 1, 1.5];
    return [0.5, 1, 2, 3];
  }

  /* מקבל DD/MM/YYYY (וגם נקודה או מקף כמפריד, ושנה דו־ספרתית) ושעה בת 24
     שעות. מחזיר null על קלט שאינו תאריך אמיתי, כדי שלא תישמר שעה שהומצאה. */
  function combineDateTime(dateValue, timeValue, fallback) {
    var date = String(dateValue || '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    var clock = String(timeValue || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!date || !clock) return null;

    var day = parseInt(date[1], 10);
    var month = parseInt(date[2], 10);
    var year = parseInt(date[3], 10);
    if (year < 100) year += 2000;
    var hours = parseInt(clock[1], 10);
    var minutes = parseInt(clock[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hours > 23 || minutes > 59) return null;

    var d = new Date(fallback ? fallback.getTime() : Date.now());
    d.setFullYear(year, month - 1, day);
    d.setHours(hours, minutes, 0, 0);
    /* 31 בחודש בן 30 יום גולש לחודש הבא — זה אינו התאריך שנכתב. */
    if (d.getDate() !== day || d.getMonth() !== month - 1) return null;
    return d;
  }

  /* ─────────── דיאלוג עריכה ─────────── */

  var editState = { id: null, onSave: null, onDelete: null };

  function initEditDialog(handlers) {
    fillSelect(el('editUnit'), unitOptions(), 'ללא יחידה');
    fillSelect(el('editMeal'), mealOptions(), 'ללא ארוחה');
    fillSelect(el('editIntensity'), intensityOptions(), 'לא צוינה');

    on('editSave', 'click', function () {
      var patch = readEditForm();
      if (!patch) return;
      handlers.onSave(editState.id, patch);
      closeDialog(el('editDialog'));
    });
    on('editCancel', 'click', function () { closeDialog(el('editDialog')); });
    on('editDelete', 'click', function () {
      handlers.onDelete(editState.id);
      closeDialog(el('editDialog'));
    });

    on('editSplit', 'click', function () {
      var patch = readEditForm();
      if (!patch) return;
      handlers.onSplit(editState.id, patch);
      closeDialog(el('editDialog'));
    });

    /* הכפתור פעיל רק כשיש באמת מה לפצל, ומתעדכן תוך כדי עריכת השם. */
    on('editName', 'input', refreshSplitState);

    /* משך ושעת סיום הם שני צדדים של אותו דבר: עריכת אחד מעדכנת את השני, וכך
       אפשר לרשום אימון גם לפי "מ-19:00 עד 20:30" וגם לפי "90 דקות". */
    on('editDuration', 'input', syncEndFromDuration);
    on('editDate', 'change', syncEndFromDuration);
    on('editTime', 'change', syncEndFromDuration);
    on('editEnd', 'input', syncDurationFromEnd);
  }

  function editStart() {
    return combineDateTime(el('editDate').value, el('editTime').value, new Date());
  }

  function syncEndFromDuration() {
    if (el('editDialog').dataset.type !== 'workout') return;
    var start = editStart();
    var minutes = parseFloat(el('editDuration').value);
    if (!start || !isFinite(minutes) || minutes <= 0) {
      el('editEnd').value = '';
      return;
    }
    el('editEnd').value = timeInputValue(new Date(start.getTime() + minutes * 60000));
  }

  function syncDurationFromEnd() {
    if (el('editDialog').dataset.type !== 'workout') return;
    var start = editStart();
    var clock = String(el('editEnd').value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!start || !clock) return;

    var end = new Date(start.getTime());
    end.setHours(parseInt(clock[1], 10), parseInt(clock[2], 10), 0, 0);
    /* סיום מוקדם מההתחלה פירושו שהאימון חצה את חצות. */
    if (end <= start) end.setDate(end.getDate() + 1);
    el('editDuration').value = Math.round((end - start) / 60000);
  }

  function refreshSplitState() {
    var button = el('editSplit');
    if (!button) return;
    button.disabled = !canSplitText(el('editName').value, el('editDialog').dataset.type);
  }

  function canSplitText(text, type) {
    var source = (text || '').trim();
    if (!source) return false;
    var parts;
    /* כשלון בניתוח לא אמור למנוע פתיחה של חלון העריכה. */
    try {
      parts = global.Parser.parse(source, new Date(), { splitWith: true });
    } catch (err) {
      return false;
    }
    if (parts.length < 2) return false;
    /* פיצול שכל חלקיו מאבדים את שמם אינו פיצול שימושי. */
    return parts.every(function (part) { return part.name && part.name !== (type === 'workout' ? 'אימון' : 'אוכל'); });
  }

  function openEdit(rec) {
    editState.id = rec.id;
    el('editName').value = rec.name || '';
    el('editDate').value = dateInputValue(rec.ts);
    el('editTime').value = timeInputValue(rec.ts);
    el('editAmount').value = rec.amount != null ? rec.amount : '';
    el('editUnit').value = rec.unit || '';
    el('editMeal').value = rec.meal || '';
    el('editCalories').value = rec.calories != null ? rec.calories : '';
    el('editDuration').value = rec.durationMin != null ? rec.durationMin : '';
    var recEnd = endOf(rec);
    el("editEnd").value = recEnd ? timeInputValue(recEnd) : "";
    el('editIntensity').value = rec.intensity || '';
    el('editNote').value = rec.note || '';
    /* טקסט מקורי ארוך במיוחד מוצג מקוצר, כדי שלא ימתח את החלון. */
    var raw = rec.raw || '';
    if (raw.length > 160) raw = raw.slice(0, 160) + '…';
    el('editRaw').textContent = raw ? 'נרשם מהטקסט: "' + raw + '"' : '';
    el('editFoodFields').hidden = rec.type !== 'food';
    el('editWorkoutFields').hidden = rec.type !== 'workout';
    el('editDialog').dataset.type = rec.type;
    refreshSplitState();
    openDialog(el('editDialog'));
  }

  function readEditForm() {
    var name = el('editName').value.trim();
    if (!name) { el('editName').focus(); return null; }
    var ts = combineDateTime(el('editDate').value, el('editTime').value, new Date());
    /* תאריך או שעה שאי אפשר לקרוא לא ייהפכו בשקט ל"עכשיו". */
    if (!ts) {
      toast('תאריך או שעה לא תקינים. התבנית היא DD/MM/YYYY ושעון 24 שעות.');
      el('editDate').focus();
      return null;
    }
    var type = el('editDialog').dataset.type;
    var patch = {
      name: name,
      ts: ts.toISOString(),
      note: el('editNote').value.trim()
    };
    if (type === 'food') {
      patch.amount = numOrNull(el('editAmount').value);
      patch.unit = el('editUnit').value || null;
      patch.meal = el('editMeal').value || null;
      patch.calories = numOrNull(el('editCalories').value);
    } else {
      patch.durationMin = numOrNull(el('editDuration').value);
      patch.intensity = el('editIntensity').value || null;
    }
    return patch;
  }

  function numOrNull(value) {
    if (value === '' || value == null) return null;
    var n = parseFloat(value);
    return isFinite(n) ? n : null;
  }

  /* ─────────── דיאלוגים והודעות ─────────── */

  /* דפדפנים ישנים (Safari לפני 15.4, למשל) אינם מכירים <dialog>: שם אין
     showModal, ואין גם הסתרה אוטומטית. במקרה כזה מסמנים את החלון כ-fallback
     וה-CSS מציג אותו כחלון צף בעצמו. */
  function openDialog(dialog) {
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
        return;
      } catch (err) { /* ממשיכים למסלול הפשוט */ }
    }
    dialog.classList.add('is-fallback');
    addFallbackClose(dialog);
    dialog.setAttribute('open', '');
    /* החלון נפתח מלמעלה, כדי שהכפתור הראשון יהיה גלוי מיד. */
    dialog.scrollTop = 0;
  }

  function addFallbackClose(dialog) {
    if (dialog.querySelector('.sheet-close')) return;
    var button = h('button', {
      class: 'sheet-close',
      type: 'button',
      'aria-label': 'סגירה',
      onclick: function () { closeDialog(dialog); }
    }, ['×']);
    dialog.insertBefore(button, dialog.firstChild);
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === 'function' && !dialog.classList.contains('is-fallback')) {
      dialog.close();
      return;
    }
    dialog.removeAttribute('open');
  }

  var toastTimer = null;
  function toast(message) {
    var node = el('toast');
    node.textContent = message;
    node.hidden = false;
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      node.classList.remove('is-visible');
      setTimeout(function () { node.hidden = true; }, 250);
    }, 2600);
  }

  global.UI = {
    el: el,
    on: on,
    h: h,
    formatNum: formatNum,
    quantityText: quantityText,
    dayHeading: dayHeading,
    heDate: heDate,
    heDateShort: heDateShort,
    heTime: heTime,
    dateInputValue: dateInputValue,
    timeInputValue: timeInputValue,
    renderStats: renderStats,
    renderWeek: renderWeek,
    renderLog: renderLog,
    renderRecent: renderRecent,
    renderDrafts: renderDrafts,
    initEditDialog: initEditDialog,
    openEdit: openEdit,
    openDialog: openDialog,
    closeDialog: closeDialog,
    combineDateTime: combineDateTime,
    toast: toast
  };
})(window);
