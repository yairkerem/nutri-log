/* שמירה מקומית של הרשומות, יחד עם ייצוא וייבוא. */
(function (global) {
  'use strict';

  var KEY = 'nutrilog.records.v1';
  /* המפתח מלפני שינוי השם ל-Nutri Log. הרשומות מועתקות ממנו פעם אחת. */
  var LEGACY_KEY = 'dietdiary.records.v1';
  var records = [];
  var listeners = [];

  function uid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function load() {
    var migrated = false;
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw === null) {
        raw = global.localStorage.getItem(LEGACY_KEY);
        migrated = raw !== null;
      }
      records = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(records)) records = [];
    } catch (err) {
      records = [];
      migrated = false;
    }
    sort();
    /* העותק הישן נשאר במקומו כרשת ביטחון. */
    if (migrated) persist();
    return records;
  }

  function persist() {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(records));
      return true;
    } catch (err) {
      return false;
    }
  }

  function sort() {
    records.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
  }

  function emit() {
    listeners.forEach(function (fn) { fn(records); });
  }

  function onChange(fn) { listeners.push(fn); }

  function normalizeRecord(input) {
    var now = new Date().toISOString();
    var rec = {
      id: input.id || uid(),
      type: input.type === 'workout' ? 'workout' : 'food',
      name: (input.name || '').trim(),
      amount: numOrNull(input.amount),
      unit: input.unit || null,
      meal: input.meal || null,
      calories: numOrNull(input.calories),
      durationMin: numOrNull(input.durationMin),
      distanceKm: numOrNull(input.distanceKm),
      steps: numOrNull(input.steps),
      sets: numOrNull(input.sets),
      reps: numOrNull(input.reps),
      intensity: input.intensity || null,
      note: (input.note || '').trim(),
      raw: (input.raw || '').trim(),
      source: input.source || 'text',
      ts: input.ts || now,
      createdAt: input.createdAt || now,
      updatedAt: now
    };
    if (rec.type === 'workout') { rec.amount = null; rec.unit = null; rec.meal = null; }
    return rec;
  }

  function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  function add(input) {
    var rec = normalizeRecord(input);
    records.push(rec);
    sort();
    persist();
    emit();
    return rec;
  }

  function addMany(list) {
    var added = list.map(function (item) {
      var rec = normalizeRecord(item);
      records.push(rec);
      return rec;
    });
    sort();
    persist();
    emit();
    return added;
  }

  function update(id, patch) {
    var idx = indexOf(id);
    if (idx < 0) return null;
    var merged = Object.assign({}, records[idx], patch, { id: id, createdAt: records[idx].createdAt });
    records[idx] = normalizeRecord(merged);
    sort();
    persist();
    emit();
    return records[idx];
  }

  function remove(id) {
    var idx = indexOf(id);
    if (idx < 0) return false;
    records.splice(idx, 1);
    persist();
    emit();
    return true;
  }

  function indexOf(id) {
    for (var i = 0; i < records.length; i++) { if (records[i].id === id) return i; }
    return -1;
  }

  function get(id) {
    var idx = indexOf(id);
    return idx < 0 ? null : records[idx];
  }

  function all() { return records.slice(); }

  function wipe() {
    records = [];
    persist();
    emit();
  }

  function replaceAll(list) {
    records = list.map(normalizeRecord);
    sort();
    persist();
    emit();
    return records.length;
  }

  /* ─────────── שאילתות ─────────── */

  function startOfDay(d) {
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function query(opts) {
    opts = opts || {};
    var from = null;
    if (opts.range === 'today') from = startOfDay(new Date());
    else if (opts.range && opts.range !== 'all') {
      var days = parseInt(opts.range, 10);
      if (isFinite(days)) {
        from = startOfDay(new Date());
        from.setDate(from.getDate() - (days - 1));
      }
    }
    var text = (opts.search || '').trim().toLowerCase();

    return records.filter(function (rec) {
      if (opts.type && opts.type !== 'all' && rec.type !== opts.type) return false;
      if (from && new Date(rec.ts) < from) return false;
      if (text) {
        var haystack = [rec.name, rec.note, rec.raw].join(' ').toLowerCase();
        if (haystack.indexOf(text) < 0) return false;
      }
      return true;
    });
  }

  /* רשומות בין שני תאריכים, כולל שני הקצוות. null פירושו בלי הגבלה. */
  function inRange(from, to) {
    var start = from ? startOfDay(from) : null;
    var end = null;
    if (to) {
      end = startOfDay(to);
      end.setDate(end.getDate() + 1);
    }
    return records.filter(function (rec) {
      var t = new Date(rec.ts);
      if (start && t < start) return false;
      if (end && t >= end) return false;
      return true;
    });
  }

  function dayStats(date) {
    var from = startOfDay(date || new Date());
    var to = new Date(from);
    to.setDate(to.getDate() + 1);
    var stats = { food: 0, workout: 0, minutes: 0, distance: 0, calories: 0, steps: 0 };
    records.forEach(function (rec) {
      var t = new Date(rec.ts);
      if (t < from || t >= to) return;
      if (rec.type === 'food') {
        stats.food++;
        if (rec.calories) stats.calories += rec.calories;
      } else {
        stats.workout++;
        if (rec.durationMin) stats.minutes += rec.durationMin;
        if (rec.distanceKm) stats.distance += rec.distanceKm;
        if (rec.steps) stats.steps += rec.steps;
      }
    });
    stats.minutes = Math.round(stats.minutes);
    stats.distance = Math.round(stats.distance * 10) / 10;
    return stats;
  }

  function lastDays(count) {
    var out = [];
    for (var i = count - 1; i >= 0; i--) {
      var d = startOfDay(new Date());
      d.setDate(d.getDate() - i);
      out.push({ date: d, stats: dayStats(d) });
    }
    return out;
  }

  /* פריטים שחזרו לאחרונה, לשימוש כקיצור דרך. */
  function recent(limit) {
    var seen = {};
    var out = [];
    for (var i = 0; i < records.length && out.length < (limit || 6); i++) {
      var rec = records[i];
      var key = rec.type + '|' + rec.name;
      if (seen[key]) continue;
      seen[key] = true;
      out.push(rec);
    }
    return out;
  }

  /* ─────────── ייצוא וייבוא ─────────── */

  var CSV_COLUMNS = [
    ['מזהה', function (r) { return r.id; }],
    ['חותמת זמן', function (r) { return r.ts; }],
    ['תאריך', function (r) { return displayDate(r.ts); }],
    ['שעה', function (r) { return localTime(r.ts); }],
    ['יום בשבוע', function (r) { return weekday(r.ts); }],
    ['סוג', function (r) { return r.type === 'food' ? 'אוכל' : 'אימון'; }],
    ['שם', function (r) { return r.name; }],
    ['כמות', function (r) { return r.amount; }],
    ['יחידה', function (r) { return unitLabel(r); }],
    ['ארוחה', function (r) { return mealLabel(r); }],
    ['קלוריות', function (r) { return r.calories; }],
    ['דקות', function (r) { return r.durationMin; }],
    ['ק"מ', function (r) { return r.distanceKm; }],
    ['צעדים', function (r) { return r.steps; }],
    ['סטים', function (r) { return r.sets; }],
    ['חזרות', function (r) { return r.reps; }],
    ['עצימות', function (r) { return intensityLabel(r); }],
    ['הערה', function (r) { return r.note; }],
    ['טקסט מקורי', function (r) { return r.raw; }],
    ['מקור', function (r) { return r.source === 'voice' ? 'הכתבה' : 'הקלדה'; }]
  ];

  function unitLabel(rec) {
    if (!rec.unit) return '';
    var unit = global.Lexicon.unitByKey(rec.unit);
    if (!unit) return rec.unit;
    return rec.amount != null && rec.amount !== 1 ? unit.plural : unit.label;
  }

  function mealLabel(rec) {
    var meal = rec.meal && global.Lexicon.mealByKey(rec.meal);
    return meal ? meal.label : '';
  }

  function intensityLabel(rec) {
    var it = rec.intensity && global.Lexicon.intensityByKey(rec.intensity);
    return it ? it.label : '';
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  /* ISO — לשמות קבצים ולעמודת חותמת הזמן, כך שמיון לפי טקסט הוא מיון כרונולוגי. */
  function localDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* DD/MM/YYYY — לעמודה שקוראים בעיניים. */
  function displayDate(ts) {
    var d = new Date(ts);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function localTime(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  var WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  function weekday(ts) { return WEEKDAYS[new Date(ts).getDay()]; }

  function csvCell(value) {
    if (value === null || value === undefined) return '';
    var s = String(value);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* ברירת המחדל היא כל הרשומות; אפשר להעביר רשימה מסוננת. הסדר כרונולוגי. */
  function toCsv(list) {
    var rows = (list || all()).slice().sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
    var lines = [CSV_COLUMNS.map(function (col) { return csvCell(col[0]); }).join(',')];
    rows.forEach(function (rec) {
      lines.push(CSV_COLUMNS.map(function (col) { return csvCell(col[1](rec)); }).join(','));
    });
    return '﻿' + lines.join('\r\n');
  }

  function toJson() {
    return JSON.stringify({
      app: 'nutrilog',
      version: 1,
      exportedAt: new Date().toISOString(),
      records: all().slice().reverse()
    }, null, 2);
  }

  function fromJson(text) {
    var data = JSON.parse(text);
    var list = Array.isArray(data) ? data : data.records;
    if (!Array.isArray(list)) throw new Error('קובץ לא מזוהה');
    var existing = {};
    records.forEach(function (rec) { existing[rec.id] = true; });
    var fresh = list.filter(function (rec) { return rec && !existing[rec.id]; });
    if (!fresh.length) return 0;
    return addMany(fresh).length;
  }

  global.Store = {
    load: load,
    all: all,
    get: get,
    add: add,
    addMany: addMany,
    update: update,
    remove: remove,
    wipe: wipe,
    replaceAll: replaceAll,
    query: query,
    inRange: inRange,
    dayStats: dayStats,
    lastDays: lastDays,
    recent: recent,
    onChange: onChange,
    toCsv: toCsv,
    toJson: toJson,
    fromJson: fromJson,
    labels: { unit: unitLabel, meal: mealLabel, intensity: intensityLabel },
    localDate: localDate,
    localTime: localTime
  };
})(window);
