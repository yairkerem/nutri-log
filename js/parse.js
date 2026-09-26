/* ניתוח טקסט חופשי בעברית לרשומות של אוכל ואימון. */
(function (global) {
  'use strict';

  var L = global.Lexicon;

  /* גבולות מילה בעברית: \b של JS לא עובד על אותיות עבריות. */
  var BL = '(?<![א-תA-Za-z0-9])';
  var BR = '(?![א-תA-Za-z0-9])';
  var PREFIX = '(?:[ובכלה]{0,2}-?)';

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* חלופות רגולריות מהארוך לקצר, כדי ש"שלושים" לא ייקרא כ"שלוש". */
  function altOf(words) {
    return words.slice().sort(function (a, b) { return b.length - a.length; })
      .map(escapeRe).join('|');
  }

  function aliasesOf(list) {
    var out = [];
    list.forEach(function (item) { out = out.concat(item.aliases); });
    return out;
  }

  var NUMBER_WORD_ALT = altOf(Object.keys(L.NUMBER_WORDS));
  var FRACTION_ALT = Object.keys(L.FRACTION_CHARS).map(escapeRe).join('|');

  var DIGIT_NUM = '(?<![0-9])\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*\\d+)?';
  var WORD_NUM = BL + 'ו?(?:' + NUMBER_WORD_ALT + ')' + BR;
  var NUM = '(?:' + DIGIT_NUM + '|' + FRACTION_ALT + '|' + WORD_NUM + ')';

  var UNIT_ALT = altOf(aliasesOf(L.UNITS));
  var TIME_ALT = altOf(aliasesOf(L.TIME_UNITS));
  var DIST_ALT = altOf(aliasesOf(L.DISTANCE_UNITS));
  var ACTIVITY_ALT = altOf(aliasesOf(L.ACTIVITIES));
  var MEAL_ALT = altOf(aliasesOf(L.MEALS));
  var INTENSITY_ALT = altOf(aliasesOf(L.INTENSITIES));
  var HINT_ALT = altOf(L.WORKOUT_HINTS);
  var VERB_ALT = altOf(L.FOOD_VERBS);
  var PART_OF_DAY_ALT = '(?:[בה]?(?:בוקר|צהריים|צהרים|ערב|לילה))';

  function token(alt) { return BL + PREFIX + '(' + alt + ')' + BR; }

  /* ─────────── נרמול ─────────── */

  function normalize(text) {
    return String(text || '')
      .replace(/[׳‘’']/g, "'")
      .replace(/[״“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/(\d)\s*,\s*(\d)/g, '$1.$2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripPrefix(word) {
    var w = String(word).replace(/^[ובכלה]{0,2}-?/, '');
    return w || word;
  }

  function parseNumberToken(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (L.FRACTION_CHARS[s] != null) return L.FRACTION_CHARS[s];
    if (/^\d+(?:\.\d+)?\s*\/\s*\d+$/.test(s)) {
      var parts = s.split('/');
      var den = parseFloat(parts[1]);
      return den ? parseFloat(parts[0]) / den : null;
    }
    if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
    var word = s.replace(/^ו/, '');
    if (L.NUMBER_WORDS[word] != null) return L.NUMBER_WORDS[word];
    if (L.NUMBER_WORDS[s] != null) return L.NUMBER_WORDS[s];
    return null;
  }

  /* ─────────── מנוע צריכה: כל התאמה נמחקת מהטקסט ─────────── */

  function blank(text, index, length) {
    return text.slice(0, index) + new Array(length + 1).join(' ') + text.slice(index + length);
  }

  function consume(state, source, handler) {
    var re = new RegExp(source, 'g');
    var m;
    while ((m = re.exec(state.work)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (!handler || handler(m) !== false) {
        state.work = blank(state.work, m.index, m[0].length);
        return true;
      }
    }
    return false;
  }

  function findAlias(text, alt) {
    var m = new RegExp(token(alt)).exec(text);
    return m ? { text: m[1], index: m.index } : null;
  }

  /* ─────────── זמן ─────────── */

  function extractTime(state, now, type) {
    var shift = 0;
    var hour = null;
    var minute = 0;
    var explicit = false;

    consume(state, 'לפני\\s*שעתיים' + BR, function () {
      var t = new Date(now.getTime() - 7200000);
      hour = t.getHours(); minute = t.getMinutes(); shift = dayDiff(t, now);
      explicit = true;
    });

    if (!explicit) consume(state, 'לפני\\s*(' + NUM + ')\\s*(דקות|דקה|דק|שעות|שעה)', function (m) {
      var n = parseNumberToken(m[1]);
      if (n == null) return false;
      var mult = /שע/.test(m[2]) ? 60 : 1;
      var t = new Date(now.getTime() - n * mult * 60000);
      hour = t.getHours(); minute = t.getMinutes(); shift = dayDiff(t, now);
      explicit = true;
    });

    if (!explicit) {
      consume(state, 'לפני\\s*שעה' + BR, function () {
        var t = new Date(now.getTime() - 3600000);
        hour = t.getHours(); minute = t.getMinutes(); shift = dayDiff(t, now);
        explicit = true;
      });
    }

    consume(state, BL + 'שלשום' + BR, function () { shift = -2; });
    consume(state, BL + '[הב]?אתמול' + BR, function () { shift = -1; });
    consume(state, BL + 'היום' + BR, function () { /* ברירת המחדל */ });

    if (hour == null) {
      consume(state, '(?:בשעה|בשעות)\\s*(\\d{1,2})(?:[:.](\\d{2}))?', function (m) {
        hour = parseInt(m[1], 10);
        minute = m[2] ? parseInt(m[2], 10) : 0;
        explicit = true;
      });
    }
    if (hour == null) {
      consume(state, '(?<![0-9])(\\d{1,2}):(\\d{2})(?![0-9])', function (m) {
        hour = parseInt(m[1], 10);
        minute = parseInt(m[2], 10);
        explicit = true;
      });
    }
    if (hour == null) {
      /* "ב-8 בבוקר" היא שעה; "ב-32 דקות" הוא משך, ולכן נדרש הקשר של חלק ביום
         (או סוף המשפט, ורק ברשומת אוכל שבה אין משך בכלל). */
      var tail = '\\s*(?=' + PART_OF_DAY_ALT + (type === 'food' ? '|\\s*$' : '') + ')';
      consume(state, '(?<![0-9:])ב-?(\\d{1,2})(?::(\\d{2}))?' + tail, function (m) {
        var h = parseInt(m[1], 10);
        if (h > 23) return false;
        hour = h;
        minute = m[2] ? parseInt(m[2], 10) : 0;
        explicit = true;
      });
    }
    if (hour == null) {
      var partsOfDay = [
        { re: '(?:ה|ב)בוקר', h: 8 },
        { re: 'לפנות בוקר', h: 6 },
        { re: '(?:ב|ה)?צה[רי]?[יר]?ים', h: 13 },
        { re: 'אחר הצהריים|אחה"צ', h: 16 },
        { re: '(?:ה|ב)ערב', h: 20 },
        { re: '(?:ה|ב)לילה', h: 23 }
      ];
      for (var i = 0; i < partsOfDay.length && hour == null; i++) {
        consume(state, BL + '(?:' + partsOfDay[i].re + ')' + BR, (function (h) {
          return function () { hour = h; minute = 0; };
        })(partsOfDay[i].h));
      }
    }

    var ts = new Date(now.getTime());
    ts.setSeconds(0, 0);
    if (hour != null) {
      ts.setHours(Math.min(23, Math.max(0, hour)), Math.min(59, Math.max(0, minute)), 0, 0);
    }
    if (shift) ts.setDate(ts.getDate() + shift);
    return { ts: ts, explicit: explicit || hour != null || shift !== 0 };
  }

  function dayDiff(a, b) {
    var da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    var db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((da - db) / 86400000);
  }

  /* ─────────── סוג הרשומה ─────────── */

  function detectType(text) {
    var activity = findAlias(text, ACTIVITY_ALT);
    var hint = findAlias(text, HINT_ALT);
    var verb = findAlias(text, VERB_ALT);
    var workoutIndex = null;
    if (activity) workoutIndex = activity.index;
    if (hint && (workoutIndex == null || hint.index < workoutIndex)) workoutIndex = hint.index;
    if (workoutIndex == null) return 'food';
    if (verb && verb.index < workoutIndex) return 'food';
    return 'workout';
  }

  /* ─────────── אוכל ─────────── */

  function fillFood(state, rec) {
    consume(state, '(' + NUM + ')\\s*(?:קלוריות|קלוריה|קל\')', function (m) {
      var n = parseNumberToken(m[1]);
      if (n == null) return false;
      rec.calories = n;
    });

    consume(state, token(MEAL_ALT), function (m) {
      var meal = L.mealIndex[stripPrefix(m[1])] || L.mealIndex[m[1]];
      if (!meal) return false;
      rec.meal = meal.key;
    });

    var matched = consume(state, '(' + NUM + ')\\s*' + token(UNIT_ALT), function (m) {
      var n = parseNumberToken(m[1]);
      var unit = L.unitIndex[stripPrefix(m[2])] || L.unitIndex[m[2]];
      if (n == null || !unit) return false;
      rec.amount = n;
      rec.unit = unit.key;
    });

    if (!matched) {
      matched = consume(state, token(UNIT_ALT) + '\\s*(' + NUM + ')', function (m) {
        var unit = L.unitIndex[stripPrefix(m[1])] || L.unitIndex[m[1]];
        var n = parseNumberToken(m[2]);
        if (n == null || !unit) return false;
        rec.amount = n;
        rec.unit = unit.key;
      });
    }

    if (!matched) {
      matched = consume(state, '(' + NUM + ')', function (m) {
        var n = parseNumberToken(m[1]);
        if (n == null) return false;
        rec.amount = n;
        rec.unit = 'unit';
      });
    }

    if (!matched) {
      consume(state, token(UNIT_ALT), function (m) {
        var unit = L.unitIndex[stripPrefix(m[1])] || L.unitIndex[m[1]];
        if (!unit) return false;
        rec.amount = 1;
        rec.unit = unit.key;
      });
    }

    if (!rec.meal) rec.meal = mealFromHour(new Date(rec.ts).getHours());
  }

  function mealFromHour(h) {
    if (h >= 5 && h < 11) return 'breakfast';
    if (h >= 11 && h < 16) return 'lunch';
    if (h >= 17 && h < 22) return 'dinner';
    return 'snack';
  }

  /* ─────────── אימון ─────────── */

  function fillWorkout(state, rec) {
    consume(state, BL + 'שעתיים' + BR, function () { rec.durationMin = 120; });

    if (rec.durationMin == null) {
      consume(state, '(' + NUM + ')\\s*ו?חצי\\s*' + token(TIME_ALT), function (m) {
        var n = parseNumberToken(m[1]);
        var unit = L.timeUnitIndex[stripPrefix(m[2])] || L.timeUnitIndex[m[2]];
        if (n == null || !unit) return false;
        rec.durationMin = round1(n * unit.minutes + unit.minutes / 2);
      });
    }
    if (rec.durationMin == null) {
      consume(state, token(TIME_ALT) + '\\s*ו?חצי' + BR, function (m) {
        var unit = L.timeUnitIndex[stripPrefix(m[1])] || L.timeUnitIndex[m[1]];
        if (!unit) return false;
        rec.durationMin = round1(unit.minutes * 1.5);
      });
    }
    if (rec.durationMin == null) {
      consume(state, '(' + NUM + ')\\s*' + token(TIME_ALT), function (m) {
        var n = parseNumberToken(m[1]);
        var unit = L.timeUnitIndex[stripPrefix(m[2])] || L.timeUnitIndex[m[2]];
        if (n == null || !unit) return false;
        rec.durationMin = round1(n * unit.minutes);
      });
    }

    consume(state, '(' + NUM + ')\\s*' + token(DIST_ALT), function (m) {
      var n = parseNumberToken(m[1]);
      var unit = L.distanceUnitIndex[stripPrefix(m[2])] || L.distanceUnitIndex[m[2]];
      if (n == null || !unit) return false;
      rec.distanceKm = round2(n * unit.km);
    });

    consume(state, '(' + NUM + ')\\s*' + BL + PREFIX + '(?:צעדים|צעד)' + BR, function (m) {
      var n = parseNumberToken(m[1]);
      if (n == null) return false;
      rec.steps = Math.round(n);
    });

    consume(state, '(' + NUM + ')\\s*' + BL + PREFIX + '(?:סטים|סט)' + BR, function (m) {
      var n = parseNumberToken(m[1]);
      if (n == null) return false;
      rec.sets = Math.round(n);
    });

    consume(state, '(' + NUM + ')\\s*' + BL + PREFIX + '(?:חזרות|חזרה|פעמים)' + BR, function (m) {
      var n = parseNumberToken(m[1]);
      if (n == null) return false;
      rec.reps = Math.round(n);
    });

    if (rec.sets == null && rec.reps == null) {
      consume(state, '(' + NUM + ')\\s*(?:על|[xX*])\\s*(' + NUM + ')', function (m) {
        var a = parseNumberToken(m[1]);
        var b = parseNumberToken(m[2]);
        if (a == null || b == null) return false;
        rec.sets = Math.round(a);
        rec.reps = Math.round(b);
      });
    }

    consume(state, token(INTENSITY_ALT), function (m) {
      var it = L.intensityIndex[stripPrefix(m[1])] || L.intensityIndex[m[1]];
      if (!it) return false;
      rec.intensity = it.key;
    });

    var activityName = null;
    consume(state, token(ACTIVITY_ALT), function (m) {
      var act = L.activityIndex[stripPrefix(m[1])] || L.activityIndex[m[1]];
      if (!act) return false;
      activityName = act.name;
    });

    if (!activityName && rec.steps != null) activityName = 'הליכה';
    rec.activityName = activityName;
  }

  /* ─────────── שם הרשומה ─────────── */

  var DROP_WORDS = {};
  L.FILLER_WORDS.concat(L.FOOD_VERBS).forEach(function (w) { DROP_WORDS[w] = true; });

  function cleanName(text) {
    var words = normalize(text).split(' ').filter(Boolean);
    var kept = words.map(function (w) {
      /* מסירים סימני פיסוק ומקפים שנשארו אחרי שליפת המספרים, כמו ב"ב-32 דקות". */
      return w.replace(/^[-.,;:!?()"']+|[-.,;:!?()"']+$/g, '');
    }).filter(function (w) {
      if (!w) return false;
      if (DROP_WORDS[w]) return false;
      if (/^\d+(?:\.\d+)?$/.test(w)) return false;
      return true;
    });
    while (kept.length && /^(עם|ו|של|את|ב|ל|כ)$/.test(kept[0])) kept.shift();
    while (kept.length && /^(עם|ו|של|את|ב|ל|כ|ועוד)$/.test(kept[kept.length - 1])) kept.pop();
    return kept.join(' ').trim();
  }

  /* ─────────── חלוקה לפריטים ─────────── */

  var VAV_BLOCKED = {};
  L.VAV_NOT_A_SPLIT.forEach(function (w) { VAV_BLOCKED[w] = true; });

  /* "אורז וסלט" הם שתי רשומות, אבל "שעה וחצי" ו"גלידה וניל" אינן. מפצלים על
     ו' החיבור רק כשהמילה שאחריה עומדת בפני עצמה. */
  function splitOnVav(text) {
    var tokens = text.split(' ').filter(Boolean);
    var parts = [];
    var current = [];

    tokens.forEach(function (token, index) {
      var bare = token.replace(/^ו-?/, '');
      var splits = index > 0 &&
        /^ו/.test(token) &&
        bare.length > 1 &&
        !VAV_BLOCKED[token] &&
        current.length > 0;

      if (splits) {
        parts.push(current.join(' '));
        current = [bare];
      } else {
        current.push(token);
      }
    });

    if (current.length) parts.push(current.join(' '));
    return parts.filter(function (part) { return part.trim().length > 0; });
  }

  /* "עם" מפריד רק כשמבקשים זאת במפורש: "קפה עם חלב" הוא פריט אחד. */
  function splitOnWith(text) {
    return text.split(new RegExp('\\sעם\\s')).map(function (part) { return part.trim(); });
  }

  function splitSegments(text, opts) {
    opts = opts || {};
    var s = normalize(text);
    L.SPLIT_WORDS.slice().sort(function (a, b) { return b.length - a.length; })
      .forEach(function (w) {
        s = s.replace(new RegExp(BL + escapeRe(w) + BR, 'g'), ',');
      });

    var segments = s.split(/[,;\n]|\s\+\s/)
      .map(function (part) { return part.trim(); })
      .filter(function (part) { return part.length > 0; });

    var expanded = [];
    segments.forEach(function (segment) {
      splitOnVav(segment).forEach(function (part) {
        if (opts.splitWith) expanded = expanded.concat(splitOnWith(part));
        else expanded.push(part);
      });
    });

    return expanded.filter(function (part) { return part.length > 0; });
  }

  /* ─────────── רשומה בודדת ─────────── */

  function parseSegment(segment, now) {
    var raw = normalize(segment);
    var state = { work: raw };
    /* הסוג נקבע לפני שליפת הזמן, כי הוא משנה את פירוש הביטוי "ב-8". */
    var type = detectType(raw);
    var time = extractTime(state, now, type);

    var rec = {
      type: type,
      name: '',
      amount: null,
      unit: null,
      meal: null,
      calories: null,
      durationMin: null,
      distanceKm: null,
      steps: null,
      sets: null,
      reps: null,
      intensity: null,
      note: '',
      raw: raw,
      ts: time.ts.toISOString(),
      tsExplicit: time.explicit
    };

    if (rec.type === 'workout') {
      fillWorkout(state, rec);
      var leftover = cleanName(state.work);
      if (rec.activityName) {
        rec.name = rec.activityName;
        rec.note = leftover;
      } else {
        rec.name = leftover || 'אימון';
      }
      delete rec.activityName;
    } else {
      fillFood(state, rec);
      rec.name = cleanName(state.work) || 'אוכל';
    }

    rec.missing = missingFields(rec);
    return rec;
  }

  function missingFields(rec) {
    if (rec.type === 'food') {
      return rec.amount == null ? ['amount'] : [];
    }
    var hasEffort = rec.durationMin != null || rec.distanceKm != null ||
      rec.steps != null || rec.reps != null;
    return hasEffort ? [] : ['effort'];
  }

  function parse(text, now, opts) {
    now = now || new Date();
    if (!normalize(text)) return [];
    return splitSegments(text, opts).map(function (segment) {
      return parseSegment(segment, now);
    }).filter(function (rec) {
      return rec.name && rec.name !== '';
    });
  }

  function round1(n) { return Math.round(n * 10) / 10; }
  function round2(n) { return Math.round(n * 100) / 100; }

  global.Parser = {
    parse: parse,
    parseSegment: parseSegment,
    splitSegments: splitSegments,
    normalize: normalize,
    parseNumberToken: parseNumberToken,
    missingFields: missingFields,
    detectType: detectType
  };
})(window);
