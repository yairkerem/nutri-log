/* הכתבה קולית בעברית מעל Web Speech API.

   המבנה כאן הולך בעקבות מה שכבר נוסה ותוקן באפליקציית יצירת האירועים, כי שתי
   ההכפלות שקרו שם קורות בכל מנוע הכתבה:

   1. הכפלת טקסט — מנוע בטלפון מתמלל מחדש את כל המשפט בכל פעם ומסמן כל גרסה
      כסופית ("דנה", "דנה אכלה", "דנה אכלה סלט"). חיבור הגרסאות זו לזו הוא
      שמכפיל את המילים, ולכן גרסה שממשיכה קודמת מחליפה אותה.

   2. הכפלת רשומות — onend נשלח בסוף כל מקטע דיבור, לא בסוף ההכתבה: המנוע
      סוגר מקטע בכל הפסקה. מי ששומר רשומה בכל onend שומר אותה שוב ושוב. לכן
      כל עוד המשתמש לא ביקש לעצור, מפעילים את המנוע מחדש ולא מדווחים על סיום.
*/
(function (global) {
  'use strict';

  var Recognition = global.SpeechRecognition || global.webkitSpeechRecognition;
  var recognition = null;
  var listening = false;
  var handlers = {};

  /* base — מה שנשמע במקטעים שכבר הסתיימו, heard — המקטע הנוכחי,
     wanted — האם המשתמש עדיין רוצה להקשיב. */
  var session = { base: '', heard: '', wanted: false };

  var ERRORS = {
    'not-allowed': 'אין הרשאה למיקרופון. יש לאשר גישה בהגדרות הדפדפן ולנסות שוב.',
    'service-not-allowed': 'שירות ההכתבה חסום בדפדפן הזה.',
    'no-speech': 'לא זוהה דיבור. אפשר לנסות שוב.',
    'audio-capture': 'לא נמצא מיקרופון פעיל.',
    'network': 'ההכתבה דורשת חיבור לאינטרנט ודף מאובטח (https).',
    'aborted': ''
  };

  function isSupported() { return !!Recognition; }

  function isSecureEnough() {
    return global.isSecureContext !== false && global.location.protocol !== 'file:';
  }

  function unsupportedReason() {
    if (!isSupported()) return 'הדפדפן הזה לא תומך בהכתבה קולית. נסו Chrome או Edge, והקלדה תמיד זמינה.';
    if (!isSecureEnough()) return 'הכתבה קולית פועלת רק כשהדף נטען מכתובת https (או localhost). הקלדה זמינה תמיד.';
    return '';
  }

  /* חיבור בעברית עם רווח אחד בדיוק: יש מנועים שמוסרים תמליל עם רווח מוביל
     ויש שלא, ובלי זה המילים נדבקות זו לזו. */
  function joinSpoken(before, spoken) {
    if (!spoken) return before;
    if (!before) return spoken;
    return /\s$/.test(before) ? before + spoken : before + ' ' + spoken;
  }

  /* האם longer הוא אותו משפט כמו shorter, רק ממשיך הלאה? */
  function extendsText(longer, shorter) {
    return shorter === '' || longer === shorter || longer.indexOf(shorter + ' ') === 0;
  }

  /* קיפול תמליל לתוך מה שנשמע עד כה. */
  function foldSpoken(heard, said) {
    if (extendsText(said, heard)) return said;   /* אותו משפט, רק ארוך יותר */
    if (extendsText(heard, said)) return heard;  /* גרסה ישנה וקצרה יותר */
    return joinSpoken(heard, said);              /* מקטע חדש באמת */
  }

  function spokenSoFar() {
    return joinSpoken(session.base, session.heard);
  }

  function create() {
    var rec = new Recognition();
    rec.lang = 'he-IL';
    rec.interimResults = true;
    /* רציף, למרות שמשם הגיעה ההכפלה: מקטע אחד לכל הפעלה אמנם פותר אותה, אבל
       מה שנאמר בזמן שהמנוע מתניע מחדש פשוט לא נשמע. כפילות אפשר לסנן, אודיו
       שאבד אבוד. החזרות מטופלות בקיפול שלמעלה ובהפעלה מחדש שלמטה. */
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onstart = function () {
      listening = true;
      if (handlers.onStart) handlers.onStart();
    };

    rec.onresult = function (event) {
      /* קוראים בכל פעם את כל הרשימה ולא מוסיפים למה שכבר נאסף: אותה תוצאה
         נמסרת שוב כשהיא מתעדכנת וכשהיא הופכת סופית, וצבירה שלהן היא הכפלה. */
      var heard = '';
      var interim = '';

      for (var i = 0; i < event.results.length; i++) {
        var result = event.results[i];
        var said = String((result[0] && result[0].transcript) || '').trim();
        if (!said) continue;
        if (result.isFinal) heard = foldSpoken(heard, said);
        else interim = foldSpoken(interim, said);
      }

      session.heard = heard;
      if (handlers.onProgress) {
        handlers.onProgress(joinSpoken(spokenSoFar(), interim));
      }
    };

    rec.onerror = function (event) {
      var message = ERRORS[event.error];
      if (message === undefined) message = 'ההכתבה נכשלה (' + event.error + ').';
      /* כל שגיאה מסיימת את ההקשבה, גם שתיקה: אחרת ההפעלה מחדש תרוץ בלולאה. */
      session.wanted = false;
      if (message && handlers.onError) handlers.onError(message, event.error);
    };

    rec.onend = function () {
      /* נשלח בסוף כל מקטע דיבור. כל עוד המשתמש לא עצר, מקפלים את מה שנשמע
         לתוך הבסיס וממשיכים להקשיב — בלי לדווח על סיום, וכך בלי לשמור רשומה. */
      if (session.wanted) {
        session.base = spokenSoFar();
        session.heard = '';
        try {
          rec.start();
          return;
        } catch (err) { /* לא הצליח להתניע מחדש — מסיימים באמת */ }
      }

      listening = false;
      var finalText = spokenSoFar();
      session.base = '';
      session.heard = '';
      if (handlers.onEnd) handlers.onEnd(finalText);
    };

    return rec;
  }

  function start(opts) {
    handlers = opts || {};
    var reason = unsupportedReason();
    if (reason) {
      if (handlers.onError) handlers.onError(reason, 'unsupported');
      return false;
    }

    session = { base: '', heard: '', wanted: true };

    try {
      if (!recognition) recognition = create();
      recognition.start();
      return true;
    } catch (err) {
      /* קריאה חוזרת ל-start בזמן האזנה זורקת שגיאה — מתעלמים ממנה. */
      return listening;
    }
  }

  function stop() {
    session.wanted = false;
    if (recognition && listening) {
      try { recognition.stop(); } catch (err) { /* nothing to do */ }
    }
  }

  global.Speech = {
    /* חשופות לבדיקות: אלה הפונקציות שמונעות את הכפלת התמליל. */
    foldSpoken: foldSpoken,
    joinSpoken: joinSpoken,
    isSupported: isSupported,
    unsupportedReason: unsupportedReason,
    isListening: function () { return listening; },
    start: start,
    stop: stop
  };
})(window);
