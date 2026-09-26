/* הכתבה קולית בעברית מעל Web Speech API. */
(function (global) {
  'use strict';

  var Recognition = global.SpeechRecognition || global.webkitSpeechRecognition;
  var recognition = null;
  var listening = false;
  var handlers = {};
  var finalText = '';

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

  function create() {
    var rec = new Recognition();
    rec.lang = 'he-IL';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onstart = function () {
      listening = true;
      finalText = '';
      if (handlers.onStart) handlers.onStart();
    };

    rec.onresult = function (event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript + ' ';
        else interim += result[0].transcript;
      }
      if (handlers.onProgress) handlers.onProgress(finalText.trim(), interim.trim());
    };

    rec.onerror = function (event) {
      var message = ERRORS[event.error];
      if (message === undefined) message = 'ההכתבה נכשלה (' + event.error + ').';
      if (message && handlers.onError) handlers.onError(message, event.error);
    };

    rec.onend = function () {
      listening = false;
      if (handlers.onEnd) handlers.onEnd(finalText.trim());
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
    if (recognition && listening) {
      try { recognition.stop(); } catch (err) { /* nothing to do */ }
    }
  }

  global.Speech = {
    isSupported: isSupported,
    unsupportedReason: unsupportedReason,
    isListening: function () { return listening; },
    start: start,
    stop: stop
  };
})(window);
