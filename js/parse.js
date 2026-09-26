/* ניתוח טקסט חופשי בעברית לרשומות של אוכל ואימון. */
(function (global) {
  'use strict';

  var L = global.Lexicon;

  /* גבולות מילה בעברית: \b של JS לא עובד על אותיות עבריות, ולכן הגבול השמאלי
     נשען על lookbehind. דפדפנים ישנים (Safari לפני 16.4) זורקים שגיאה כבר על
     בניית הביטוי, ולכן בודקים זאת פעם אחת ונופלים לגבול רופף יותר במקום
     להשאיר את האפליקציה בלי ניתוח טקסט בכלל. */
  var SUPPORTS_LOOKBEHIND = (function () {
    try {
      new RegExp('(?<!a)b');
      return true;
    } catch (err) {
      return false;
    }
  })();

  var BL = SUPPORTS_LOOKBEHIND ? '(?<![א-תA-Za-z0-9])' : '';
  var BR = '(?![א-תA-Za-z0-9])';
  var NO_DIGIT_BEFORE = SUPPORTS_LOOKBEHIND ? '(?<![0-9])' : '';
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

  /* מספרים מורכבים: "שלושים ושתיים דקות", "מאה ועשרים גרם". נבנים מהמילון
     במקום להיכתב אחת אחת, וקיומם כאן הוא גם מה שמונע מו' החיבור שבתוכם לפצל
     את המשפט לשתי רשומות. */
  var TENS = { 'עשרים': 20, 'שלושים': 30, 'ארבעים': 40, 'חמישים': 50, 'שישים': 60, 'שבעים': 70, 'שמונים': 80, 'תשעים': 90 };
  var HUNDREDS = { 'מאה': 100, 'מאתיים': 200 };
  var SINGLES = ['אחד', 'אחת', 'שניים', 'שתיים', 'שני', 'שתי', 'שלוש', 'שלושה',
    'ארבע', 'ארבעה', 'חמש', 'חמישה', 'שש', 'שישה', 'ששה', 'שבע', 'שבעה', 'שמונה', 'תשע', 'תשעה'];

  var NUMBER_LOOKUP = {};
  Object.keys(L.NUMBER_WORDS).forEach(function (word) { NUMBER_LOOKUP[word] = L.NUMBER_WORDS[word]; });
  Object.keys(TENS).forEach(function (tens) {
    SINGLES.forEach(function (single) {
      NUMBER_LOOKUP[tens + ' ו' + single] = TENS[tens] + L.NUMBER_WORDS[single];
    });
  });
  Object.keys(HUNDREDS).forEach(function (hundred) {
    Object.keys(TENS).forEach(function (tens) {
      NUMBER_LOOKUP[hundred + ' ו' + tens] = HUNDREDS[hundred] + TENS[tens];
    });
    SINGLES.forEach(function (single) {
      NUMBER_LOOKUP[hundred + ' ו' + single] = HUNDREDS[hundred] + L.NUMBER_WORDS[single];
    });
  });

  var NUMBER_WORD_ALT = altOf(Object.keys(NUMBER_LOOKUP));
  var FRACTION_ALT = Object.keys(L.FRACTION_CHARS).map(escapeRe).join('|');

  var DIGIT_NUM = NO_DIGIT_BEFORE + '\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*\\d+)?';
  /* מספר במילים נושא לעיתים אות שימוש: "בשלושים דקות", "כחמש דקות". */
  var WORD_NUM = BL + '[ובכל]{0,2}(?:' + NUMBER_WORD_ALT + ')' + BR;
  var NUM = '(?:' + DIGIT_NUM + '|' + FRACTION_ALT + '|' + WORD_NUM + ')';

  /* תוספת שמחוברת ב-ו': "שעה ורבע". ו' חייבת להיות בתוך ההתאמה ולא לפניה,
     כי גבול המילה השמאלי נבדק מול התו הקודם — ו' עצמה היא אות עברית, וכתיבתה
     בנפרד הפילה את ההתאמה של המספר שאחריה. */
  var VAV_NUM = BL + 'ו-?(?:' + NUMBER_WORD_ALT + '|\\d+(?:\\.\\d+)?)' + BR;

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
    if (NUMBER_LOOKUP[s] != null) return NUMBER_LOOKUP[s];
    /* אף מספר במילים אינו פותח באותיות השימוש, ולכן אפשר להסיר אותן בבטחה. */
    var word = s.replace(/^[ובכל]{1,2}/, '');
    if (NUMBER_LOOKUP[word] != null) return NUMBER_LOOKUP[word];
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
      consume(state, NO_DIGIT_BEFORE + '(\\d{1,2}):(\\d{2})(?![0-9])', function (m) {
        hour = parseInt(m[1], 10);
        minute = parseInt(m[2], 10);
        explicit = true;
      });
    }
    if (hour == null) {
      /* "ב-8 בבוקר" היא שעה; "ב-32 דקות" הוא משך, ולכן נדרש הקשר של חלק ביום
         (או סוף המשפט, ורק ברשומת אוכל שבה אין משך בכלל). */
      var tail = '\\s*(?=' + PART_OF_DAY_ALT + (type === 'food' ? '|\\s*$' : '') + ')';
      consume(state, NO_DIGIT_BEFORE + 'ב-?(\\d{1,2})(?::(\\d{2}))?' + tail, function (m) {
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

  /* "שעה וחצי", "שעה ורבע", "שעה ועשרים": תוספת קטנה מ-1 היא שבר של היחידה,
     ותוספת שלמה אחרי שעה היא דקות — כך אומרים את זה. */
  function durationFrom(count, unit, extra) {
    var base = count * unit.minutes;
    if (extra == null) return round1(base);
    if (extra < 1) return round1(base + extra * unit.minutes);
    if (unit.minutes >= 60) return round1(base + extra);
    return round1(base + extra * unit.minutes);
  }

  /* "שעה ארבעים דקות" — מילת הדקות שבסוף נבלעת בהתאמה ולא נשארת כהערה. */
  var MINUTES_SUFFIX = '(?:\\s*' + PREFIX + '(?:דקות|דקה|דק)' + BR + ')?';

  /* "רצתי שעה 5 קילומטר" — שם המספר הוא מרחק, לא דקות. */
  var DISTANCE_AHEAD = new RegExp('^\\s*' + PREFIX + '(?:' + DIST_ALT + ')' + BR);

  function followedByDistance(state, match) {
    return DISTANCE_AHEAD.test(state.work.slice(match.index + match[0].length));
  }

  function timeUnitOf(word) {
    return L.timeUnitIndex[stripPrefix(word)] || L.timeUnitIndex[word] || null;
  }

  function fillWorkout(state, rec) {
    var HOUR = { minutes: 60 };

    /* "שעתיים ורבע" */
    consume(state, BL + 'שעתיים\\s*(' + VAV_NUM + ')', function (m) {
      var extra = parseNumberToken(m[1]);
      if (extra == null) return false;
      rec.durationMin = durationFrom(2, HOUR, extra);
    });

    if (rec.durationMin == null) {
      consume(state, BL + 'שעתיים' + BR, function () { rec.durationMin = 120; });
    }

    /* "שתיים וחצי שעות" */
    if (rec.durationMin == null) {
      consume(state, '(' + NUM + ')\\s*(' + VAV_NUM + ')\\s*' + token(TIME_ALT), function (m) {
        var count = parseNumberToken(m[1]);
        var extra = parseNumberToken(m[2]);
        var unit = timeUnitOf(m[3]);
        if (count == null || extra == null || !unit || extra >= 1) return false;
        rec.durationMin = durationFrom(count, unit, extra);
      });
    }

    /* "שתי שעות ורבע" */
    if (rec.durationMin == null) {
      consume(state, '(' + NUM + ')\\s*' + token(TIME_ALT) + '\\s*(' + VAV_NUM + ')', function (m) {
        var count = parseNumberToken(m[1]);
        var unit = timeUnitOf(m[2]);
        var extra = parseNumberToken(m[3]);
        if (count == null || !unit || extra == null) return false;
        rec.durationMin = durationFrom(count, unit, extra);
      });
    }

    /* "שעה ורבע", "שעה ועשרים" */
    if (rec.durationMin == null) {
      consume(state, token(TIME_ALT) + '\\s*(' + VAV_NUM + ')' + MINUTES_SUFFIX, function (m) {
        var unit = timeUnitOf(m[1]);
        var extra = parseNumberToken(m[2]);
        if (!unit || extra == null) return false;
        rec.durationMin = durationFrom(1, unit, extra);
      });
    }

    /* "שעה ארבעים", "שעה ארבעים דקות", "שתי שעות ארבעים" — אותו דבר בלי ו'.
       מספר חשוף אחרי יחידת זמן הוא דקות, אלא אם הוא באמת מרחק. */
    if (rec.durationMin == null) {
      consume(state, '(' + NUM + ')\\s*' + token(TIME_ALT) + '\\s*(' + NUM + ')' + MINUTES_SUFFIX, function (m) {
        var count = parseNumberToken(m[1]);
        var unit = timeUnitOf(m[2]);
        var extra = parseNumberToken(m[3]);
        if (count == null || !unit || extra == null) return false;
        if (followedByDistance(state, m)) return false;
        rec.durationMin = durationFrom(count, unit, extra);
      });
    }

    if (rec.durationMin == null) {
      consume(state, token(TIME_ALT) + '\\s*(' + NUM + ')' + MINUTES_SUFFIX, function (m) {
        var unit = timeUnitOf(m[1]);
        var extra = parseNumberToken(m[2]);
        if (!unit || extra == null) return false;
        if (followedByDistance(state, m)) return false;
        rec.durationMin = durationFrom(1, unit, extra);
      });
    }

    if (rec.durationMin == null) {
      consume(state, '(' + NUM + ')\\s*' + token(TIME_ALT), function (m) {
        var count = parseNumberToken(m[1]);
        var unit = timeUnitOf(m[2]);
        if (count == null || !unit) return false;
        rec.durationMin = durationFrom(count, unit, null);
      });
    }

    /* יחידת זמן בלי מספר היא אחת: "הלכתי שעה", "אימון של שעה". */
    if (rec.durationMin == null) {
      consume(state, token(TIME_ALT), function (m) {
        var unit = L.timeUnitIndex[stripPrefix(m[1])] || L.timeUnitIndex[m[1]];
        if (!unit) return false;
        rec.durationMin = round1(unit.minutes);
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

    /* אוספים את כל שמות הפעילות שבמשפט, לא רק את הראשון: "התאמנתי בחדר כושר"
       פותח בפועל כללי וממשיך בפעילות עצמה, ומה שלא נאסף היה נשאר כהערה. */
    var found = [];
    var more = true;
    while (more) {
      more = consume(state, token(ACTIVITY_ALT), function (m) {
        var act = L.activityIndex[stripPrefix(m[1])] || L.activityIndex[m[1]];
        if (!act) return false;
        found.push(act.name);
      });
    }

    /* שם מפורש עדיף על "אימון" הכללי. */
    var activityName = null;
    for (var i = 0; i < found.length && !activityName; i++) {
      if (found[i] !== 'אימון') activityName = found[i];
    }
    if (!activityName && found.length) activityName = found[0];

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
      /* "שלושים ושתיים" הוא מספר אחד, לא שני פריטים. */
      var previous = index > 0 ? stripPrefix(tokens[index - 1]) : '';
      /* "שלושים ושתיים" הוא מספר, ו"שעה ורבע" הוא משך: בשניהם ו' מחברת ולא
         מפרידה. די בכך שאחריה בא מספר ולפניה מספר או יחידת זמן. */
      var joinsNumber = NUMBER_LOOKUP[bare] != null &&
        (NUMBER_LOOKUP[previous] != null || L.timeUnitIndex[previous] != null || previous === 'שעתיים');
      var insideNumber = joinsNumber;
      var splits = index > 0 &&
        /^ו/.test(token) &&
        bare.length > 1 &&
        !VAV_BLOCKED[token] &&
        !insideNumber &&
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

  /* פיצול לפי כמויות.

     מנוע ההכתבה בטלפון אינו מוסר סימני פיסוק ואינו מסמן הפסקות — הוא מוסר את
     כל המשפט מחדש בכל פעם — ולכן "שלושה שניצל כוס מיץ תפוזים שתי כפות אורז"
     מגיע כרצף אחד. אבל יש בו סימן ברור: כל פריט נפתח בכמות. מתחילים פריט חדש
     כשמופיעה כמות, ובתנאי שכבר נאסף שם של פריט, ושיש שם נוסף בהמשך — כך
     "תפוח אחד" נשאר פריט אחד ולא מתפצל לתפוח ולמספר. */
  function splitOnQuantities(text) {
    /* באימונים הכמויות הן מידות של אותו מאמץ ("חמישה קילומטר בשלושים דקות"). */
    if (detectType(text) !== 'food') return [text];

    var tokens = normalize(text).split(' ').filter(Boolean);
    var chunks = [];
    var current = [];
    var named = false;

    tokens.forEach(function (token, index) {
      if (named && startsQuantity(token) && hasNameAhead(tokens, index)) {
        chunks.push(current.join(' '));
        current = [token];
        named = false;
        return;
      }
      current.push(token);
      if (isNameWord(token)) named = true;
    });

    if (current.length) chunks.push(current.join(' '));
    return chunks;
  }

  function startsQuantity(token) {
    var bare = stripPrefix(token);
    if (parseNumberToken(token) != null || parseNumberToken(bare) != null) return true;
    return !!(L.unitIndex[token] || L.unitIndex[bare]);
  }

  function hasNameAhead(tokens, from) {
    for (var i = from + 1; i < tokens.length; i++) {
      if (isNameWord(tokens[i])) return true;
    }
    return false;
  }

  /* מילה ששייכת לשם הפריט: לא מספר, לא יחידה, לא מילת זמן או ארוחה, ולא פועל. */
  function isNameWord(token) {
    var bare = stripPrefix(token);
    if (parseNumberToken(token) != null || parseNumberToken(bare) != null) return false;
    if (MEASURE_WORDS[token] || MEASURE_WORDS[bare]) return false;
    if (DROP_WORDS[token] || DROP_WORDS[bare]) return false;
    if (L.mealIndex[token] || L.mealIndex[bare]) return false;
    return /[א-ת]/.test(token);
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
        var pieces = opts.splitWith ? splitOnWith(part) : [part];
        pieces.forEach(function (piece) {
          expanded = expanded.concat(splitOnQuantities(piece));
        });
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
      /* חותמת הזמן של אימון היא תחילתו. אם המשפט נאמר בסופו, מזיזים אותה
         אחורה במשך האימון, וכך "סיימתי עכשיו אימון של שעתיים" נרשם כאימון
         שהתחיל לפני שעתיים ולא כאימון שמתחיל עכשיו. */
      if (rec.durationMin) {
        var anchor = timeAnchor(raw, time.explicit);
        if (anchor === 'end') {
          rec.ts = new Date(time.ts.getTime() - rec.durationMin * 60000).toISOString();
        }
      }
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

  var START_ALT = altOf(L.START_MARKERS);
  var END_ALT = altOf(L.END_MARKERS);

  /* באיזה קצה של האימון נאמר המשפט. שעה מפורשת ("רצתי בשמונה") היא כמעט תמיד
     שעת ההתחלה; בלי שעה מפורשת, משפט בלשון עבר נאמר אחרי שהאימון נגמר. */
  function timeAnchor(text, explicitTime) {
    if (findAlias(text, START_ALT)) return 'start';
    if (findAlias(text, END_ALT)) return 'end';
    return explicitTime ? 'start' : 'end';
  }

  function missingFields(rec) {
    if (rec.type === 'food') {
      return rec.amount == null ? ['amount'] : [];
    }
    var hasEffort = rec.durationMin != null || rec.distanceKm != null ||
      rec.steps != null || rec.reps != null;
    return hasEffort ? [] : ['effort'];
  }

  /* חיבור מקטעי הכתבה למשפט אחד. גבול בין מקטעים הוא הפסקה בדיבור, ולרוב זה
     בדיוק המקום שבו מפרידים בין פריטים ברשימה — אבל לא תמיד: "רצתי חמישה
     קילומטר" / "בשלושים דקות" הוא משפט אחד שנחתך באמצע. לכן פסיק נכנס רק אם
     שני הצדדים עומדים בפני עצמם כרשומה עם שם אמיתי. */
  function joinSegments(segments) {
    var joined = '';
    (segments || []).forEach(function (segment) {
      var part = normalize(segment);
      if (!part) return;
      if (!joined) { joined = part; return; }
      joined += (isItemBoundary(joined, part) ? ', ' : ' ') + part;
    });
    return joined;
  }

  function isItemBoundary(left, right) {
    /* מקטע שנפתח במילת חיבור הוא המשך, לא פריט חדש. */
    if (/^(עם|ו|של|בלי|ב|ל)\s/.test(right)) return false;
    var before = parse(left);
    var after = parse(right);
    if (!before.length || !after.length) return false;
    return namedRecord(before[before.length - 1]) && namedRecord(after[0]);
  }

  /* מילות מידה: יחידות, יחידות זמן ומרחק ומספרים במילים. מקטע שכל כולו מילות
     מידה — "בשלושים דקות" — הוא המשך של המשפט הקודם ולא פריט בפני עצמו. */
  var MEASURE_WORDS = {};
  [aliasesOf(L.UNITS), aliasesOf(L.TIME_UNITS), aliasesOf(L.DISTANCE_UNITS), Object.keys(L.NUMBER_WORDS),
    /* זוגות בעברית הם כמות ולא שם: "לפני שעתיים" */
    ['שעתיים', 'יומיים', 'שבועיים', 'ארוחת', 'ארוחה', 'קלוריות', 'קלוריה', 'צעדים', 'סטים', 'חזרות']]
    .forEach(function (list) {
      list.forEach(function (word) { MEASURE_WORDS[word] = true; });
    });

  function namedRecord(rec) {
    if (!rec || !rec.name) return false;
    if (rec.name === 'אוכל' || rec.name === 'אימון') return false;
    return rec.name.split(' ').some(function (word) {
      return word && !MEASURE_WORDS[word] && !MEASURE_WORDS[stripPrefix(word)];
    });
  }

  /* רשת ביטחון להכתבה: מנוע שמוסר את אותו משפט שוב ושוב יוצר טקסט כפול, וכאן
     מכווצים חזרות רצופות של אותו רצף מילים. פועל על טקסט מוכתב בלבד. */
  function collapseRepeats(text) {
    var words = normalize(text).split(' ').filter(Boolean);
    var longest = Math.min(12, Math.floor(words.length / 2));

    for (var size = longest; size >= 1; size--) {
      var at = 0;
      while (at + size * 2 <= words.length) {
        var first = words.slice(at, at + size).join(' ');
        var second = words.slice(at + size, at + size * 2).join(' ');
        if (first === second) {
          words.splice(at + size, size); /* נשארים באותו מקום, אולי יש עוד חזרה */
        } else {
          at++;
        }
      }
    }

    return words.join(' ');
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
    collapseRepeats: collapseRepeats,
    joinSegments: joinSegments,
    parseNumberToken: parseNumberToken,
    missingFields: missingFields,
    detectType: detectType
  };
})(window);
