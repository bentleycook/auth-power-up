(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var warn = require('./util/warn');
var Promise = require('bluebird');

var temporary = {};
var retained = {};
var index = 0;

setInterval(function(){
  var refs = Object.keys(temporary);
  var now = Date.now();
  var freedCount = 0;

  refs.forEach(function(ref){
    var entry = temporary[ref];
    if(entry.expires < now) {
      freedCount++;
      delete temporary[ref];
    }
  })
}, 1000)

module.exports = {
  callback: function(t, options, serializeResult) {
    var ref = options.callback;
    var action = options.action;
    var args = options.options;

    return Promise.try(function(){
      switch(action){
        case 'run':
          if(retained.hasOwnProperty(ref)) {
            var callback = retained[ref];
            return callback.call(null, t, args);
          }
          warn("Attempted to run callback that does not exist or was not retained");
          throw t.NotHandled("callback does not exist or was not retained");
        case 'retain':
          if(temporary.hasOwnProperty(ref)){
            retained[ref] = temporary[ref].fx;
            delete temporary[ref];
            return ref;
          } else {
            warn("Attempted to retain callback that does not exist");
            throw t.NotHandled("callback can no longer be retained");
          }
        case 'release':
          if(retained.hasOwnProperty(ref)){
            delete retained[ref];
            return;
          } else {
            warn("Attempted to release callback that is not retained");
            throw t.NotHandled("callback can no longer be released");
          }
        default:
          warn("Attempted an unknown callback action");
          throw t.NotHandled("unknown callback action");
      }
    })
    .then(serializeResult);
  },
  serialize: function(fx) {
    var ref = "cb" + (index++);
    temporary[ref] = {
      fx: fx,
      expires: Date.now() + 10000
    }

    return {
      _callback: ref
    };
  }
}

},{"./util/warn":17,"bluebird":18}],2:[function(require,module,exports){
(function(){
  this.TrelloPowerUp = require('./index');
})();

},{"./index":8}],3:[function(require,module,exports){
// https://raw.githubusercontent.com/jonathantneal/closest/master/closest.js
(function (ELEMENT) {
  ELEMENT.matches = ELEMENT.matches || ELEMENT.mozMatchesSelector || ELEMENT.msMatchesSelector || ELEMENT.oMatchesSelector || ELEMENT.webkitMatchesSelector;

  ELEMENT.closest = ELEMENT.closest || function closest(selector) {
    var element = this;

    while (element) {
      if (element.matches(selector)) {
        break;
      }

      element = element.parentElement;
    }

    return element;
  };
}(Element.prototype));

},{}],4:[function(require,module,exports){
var arg = require('./util/arg');
var i18nError = require('./i18n-error');
var processResult = require('./process-result');
var relativeUrl = require('./util/relative-url');
var PostMessageIO = require('post-message-io');
var Promise = require('bluebird');
var safe = require('./util/safe');
var warn = require('./util/warn');
var xtend = require('xtend');

var HostHandlers = {};

HostHandlers.requestWithContext = function(command, options) {
  options = options || {};
  options.context = this.args[0].context;

  return this.request(command, processResult(options));
};

HostHandlers.getAll = function() {
  return this.requestWithContext('data')
  .then(function(data){
    var parsed = {};

    Object.keys(data).forEach(function(scope){
      parsed[scope] = {};
      Object.keys(data[scope]).forEach(function(visibility){
        try {
          parsed[scope][visibility] = JSON.parse(data[scope][visibility]);
        } catch(ignored) {
          parsed[scope][visibility] = {};
        }
      })
    })

    return parsed;
  });
};

HostHandlers.get = function(scope, visibility, name, defaultValue) {
  return this.getAll(scope, visibility)
  .then(function(data){
    if(data && data.hasOwnProperty(scope) &&
       data[scope].hasOwnProperty(visibility) &&
       data[scope][visibility].hasOwnProperty(name)) {
      return data[scope][visibility][name];
    } else {
      return defaultValue;
    }
  });
};

HostHandlers.set = function(scope, visibility, name, value) {
  var self = this;

  return this.getAll()
  .get(scope)
  .then(function(scopeData) {
    return scopeData || {};
  })
  .get(visibility)
  .then(function(data){
    data = data || {};
    if(typeof name === 'object') {
      var updates = name;
      Object.keys(updates).forEach(function(name){
        data[name] = updates[name];
      })
    } else {
      data[name] = value;
    }

    return self.requestWithContext('set', {
      scope: scope,
      visibility: visibility,
      data: JSON.stringify(data)
    });
  });
};

HostHandlers.remove = function(scope, visibility, names) {
  var keys = names;
  var self = this;
  if(!Array.isArray(keys)) {
    keys = [names];
  }
  if(keys.some(function(key) { return typeof key !== 'string' })) {
    warn('t.remove function takes either a single string or an array of strings for which keys to remove')
    return null;
  }

  return this.getAll()
  .get(scope)
  .then(function(scopeData) {
    return scopeData || {};
  })
  .get(visibility)
  .then(function(data) {
    data = data || {};
    keys.forEach(function(key) {
      delete data[key];
    });

    return self.requestWithContext('set', {
      scope: scope,
      visibility: visibility,
      data: JSON.stringify(data)
    });
  });
};

HostHandlers.safe = safe;

HostHandlers.arg = function(name, defaultValue) {
  var options = this.args[1];
  if(options && typeof options === 'object' && options.hasOwnProperty(name)) {
    return options[name]
  } else {
    return defaultValue;
  }
}

HostHandlers.signUrl = function(url, args) {
  var context = this.args[0].context;
  return [
    url,
    encodeURIComponent(JSON.stringify({
      secret: this.secret,
      context: context,
      locale: window.locale,
      args: args
    }))
  ].join('#');
};

HostHandlers.navigate = function(options) {
  if (!options || typeof options !== 'object' || typeof options.url !== 'string') {
    return Promise.reject(new Error("Invalid or missing url provided in options object"));
  }
  return this.requestWithContext('navigate', options);
};

HostHandlers.showCard = function(idCard) {
  if (!idCard || typeof idCard !== 'string') {
    return Promise.reject(new Error("Invalid idCard provided"));
  }
  return this.requestWithContext('showCard', { idCard: idCard });
};

HostHandlers.popup = function(options) {
  var popupOptions = {
    title: options.title,
    callback: options.callback
  };
  if (options.url) {
    popupOptions.content = {
      type: 'iframe',
      url: this.signUrl(relativeUrl(options.url), options.args),
      width: options.width,
      height: options.height
    };
  } else if(options.items) {
    var items;
    if(Array.isArray(options.items) || typeof options.items === 'function') {
      items = options.items;
    } else {
      items = Object.keys(options.items).map(function(text){
        var entry = options.items[text];
        if(typeof entry === 'function') {
          entry = {
            callback: entry
          };
        }

        return xtend({ text: text }, entry);
      })
    }
    popupOptions.content = {
      type: 'list',
      items: items,
      search: options.search
    }
  }
  return this.requestWithContext('popup', popupOptions);
};

HostHandlers.overlay = function(options) {
  var overlayOptions = {};
  if(options.url) {
    overlayOptions.content = {
      type: 'iframe',
      url: this.signUrl(relativeUrl(options.url), options.args)
    }
  }
  return this.requestWithContext('overlay', overlayOptions);
}

HostHandlers.boardBar = function(options) {
  var boardBarOptions = {};
  if(options.url) {
    boardBarOptions.content = {
      type: 'iframe',
      url: this.signUrl(relativeUrl(options.url), options.args),
      height: options.height
    }
  }
  return this.requestWithContext('board-bar', boardBarOptions);
}

// Deprecated in favor of closePopup
HostHandlers.hide = function(options){
  warn("hide() handler has been deprecated. Please use closePopup()");
  return this.requestWithContext('close-popup');
}

HostHandlers.closePopup = function(options){
  return this.requestWithContext('close-popup');
}

HostHandlers.back = function(options){
  return this.requestWithContext('pop-popup');
}

// Deprecated in favor of closeOverlay
HostHandlers.hideOverlay = function(options) {
  warn("hideOverlay() handler has been deprecated. Please use closeOverlay()");
  return this.requestWithContext('close-overlay');
}

HostHandlers.closeOverlay = function(options){
  return this.requestWithContext('close-overlay');
}

// Deprecated in favor of closeBoardBar
HostHandlers.hideBoardBar = function(options) {
  warn("hideBoardBar() handler has been deprecated. Please use closeBoardBar()");
  return this.requestWithContext('close-board-bar');
}

HostHandlers.closeBoardBar = function(options){
  return this.requestWithContext('close-board-bar');
}

HostHandlers.sizeTo = function(selector) {
  var el = document.querySelector(selector);
  if(el) {
    el.style.overflow = 'hidden';
    return this.requestWithContext('resize', {
      height: Math.ceil(Math.max(el.scrollHeight, el.getBoundingClientRect().height))
    })
  } else {
    return Promise.reject(new Error("no elements matched"));
  }
};

HostHandlers.localizeKey = function(key, data) {
  if(window.localizer && typeof window.localizer.localize === 'function'){
    return window.localizer.localize(key, data);
  } else {
    throw new i18nError.LocalizerNotFound("No localizer available for localization.");
  }
};

HostHandlers.localizeKeys = function(keys) {
  if(!keys){
    return [];
  }
  var self = this;
  return keys.map(function(key){
    if(typeof key === 'string'){
      return self.localizeKey(key);
    } else if(Array.isArray(key)){
      return self.localizeKey(key[0], key[1]);
    } else {
      throw new i18nError.UnsupportedKeyType("localizeKeys doesn't recognize the supplied key type: " + (typeof key));
    }
  })
};

HostHandlers.localizeNode = function(node) {
  var localizableNodes = node.querySelectorAll('[data-i18n-id],[data-i18n-attrs]');
  for(var i = 0, len = localizableNodes.length; i < len; i++) {
    var replacementArgs = {};
    var element = localizableNodes[i];
    if(element.dataset.i18nArgs) {
      try {
        replacementArgs = JSON.parse(element.dataset.i18nArgs);
      }
      catch (ex) {
        throw new i18nError.UnableToParseArgs("Error parsing args. Error: " + ex.message);
      }
    }
    if(element.dataset.i18nId) {
      element.textContent = this.localizeKey(element.dataset.i18nId, replacementArgs);
    }
    if(element.dataset.i18nAttrs) {
      var requestedAttributes;
      try {
        requestedAttributes = JSON.parse(element.dataset.i18nAttrs);
      }
      catch (ex) {
        throw new i18nError.UnableToParseAttrs("Error parsing attrs. Error: " + ex.message);
      }
      if(requestedAttributes && requestedAttributes.placeholder){
        element.placeholder = this.localizeKey(requestedAttributes.placeholder, replacementArgs);
      }
    }
  }
};

HostHandlers.card = function(){
  return this.requestWithContext('card', { fields: arguments });
};

HostHandlers.cards = function(){
  return this.requestWithContext('cards', { fields: arguments });
};

HostHandlers.list = function(){
  return this.requestWithContext('list', { fields: arguments });
};

HostHandlers.lists = function(){
  return this.requestWithContext('lists', { fields: arguments });
};

HostHandlers.member = function(){
  return this.requestWithContext('member', { fields: arguments });
};

HostHandlers.board = function(){
  return this.requestWithContext('board', { fields: arguments });
};

HostHandlers.attach = function(options){
  return this.requestWithContext('attach-to-card', options);
};

HostHandlers.requestToken = function(options){
  return this.requestWithContext('request-token', options);
};

HostHandlers.authorize = function(authUrl, options) {
  var url;
  var secret = PostMessageIO.randomId();
  options = options || {};

  if (typeof authUrl === 'string') {
    url = authUrl;
  } else if (typeof authUrl === 'function') {
    url = authUrl(secret);
  } else {
    warn('authorize requires a url or function that takes a secret and returns a url');
    throw new Error('Invalid arguments passed to authorize');
  }

  var isValidToken = function(token) { return true; }
  if (options.validToken && typeof options.validToken === 'function') {
     isValidToken = options.validToken;
  }

  var width = options.width || 800;
  var height = options.height || 600;
  var left = window.screenX + Math.floor((window.outerWidth - width) / 2);
  var top = window.screenY + Math.floor((window.outerHeight - height) / 2);
  var windowOpts = ['width=', width, ',height=', height, ',left=', left, ',top=', top].join('');

  var storageEventHandler = function(resolve){
    var handler = function(e){
      if(e.key == 'token' && e.newValue && isValidToken(e.newValue)){
        localStorage.removeItem('token');
        window.removeEventListener('storage', handler, false);
        delete window.authorize;
        resolve(e.newValue);
      }
    };
    return handler;
  };

  return new Promise(function(resolve){
    window.addEventListener('storage', storageEventHandler(resolve), false);
    if (typeof authUrl === 'function') {
      new PostMessageIO({
        local: window,
        remote: window.open(url, 'authorize', windowOpts),
        targetOrigin: options.targetOrigin || '*',
        secret: secret,
        handlers: {
          value: function(t, opts) {
            if(opts && opts.token && isValidToken(opts.token)) {
              this.stop();
              resolve(opts.token);
            }
          }
        }
      })
    } else {
      window.authorize = function(token) {
        if (token && isValidToken(token)) {
          delete window.authorize;
          resolve(token);
        }
      }
      window.open(url, 'authorize', windowOpts);
    }
  })
}

HostHandlers.notifyParent = function(message, options) {
  options = options || {};
  window.parent.postMessage(message, options.targetOrigin || '*');
}

module.exports = HostHandlers;

},{"./i18n-error":5,"./process-result":12,"./util/arg":13,"./util/relative-url":15,"./util/safe":16,"./util/warn":17,"bluebird":18,"post-message-io":20,"xtend":22}],5:[function(require,module,exports){
var makeErrorEnum = require('./util/make-error-enum')

module.exports = makeErrorEnum('i18n', [
  'ArgNotFound',
  'InvalidResourceUrl',
  'KeyNotFound',
  'LoadLocalizerNotAFunction',
  'LocaleNotFound',
  'LocaleNotSpecified',
  'LocalizerNotFound',
  'MissingDefaultLocale',
  'MissingResourceUrl',
  'MissingSupportedLocales',
  'UnableToParseArgs',
  'UnableToParseAttrs',
  'Unknown',
  'UnsupportedKeyType'
]);

},{"./util/make-error-enum":14}],6:[function(require,module,exports){
var i18nError = require('./i18n-error');
var Promise = require('bluebird');

var loadOnce;
var localizer;
var activeLocale = '';

var urlForLocale = function(baseResourceUrl, locale){
  if(baseResourceUrl.indexOf('{locale}') < 0){
    throw new i18nError.InvalidResourceUrl("ResourceUrl must specify where to place locale with {locale}");
  }
  return baseResourceUrl.replace('{locale}', locale);
}

var closestSupportedLocale = function(requestedLocale, defaultLocale, supportedLocales){
  if(supportedLocales.indexOf(requestedLocale) > -1) {
    return requestedLocale;
  } else if(requestedLocale.indexOf('-') > -1) {
    return closestSupportedLocale(requestedLocale.split('-')[0], defaultLocale, supportedLocales);
  } else {
    return defaultLocale;
  }
}

var localize = function(key, args){
  var self = this;
  if(self.resourceDictionary[key]) {
    var rawString = self.resourceDictionary[key];
    if(args){
      var formattedString = '';
      var holeRegex = /\{(\w+?)\}/gi;
      var hole;
      var index = 0;
      while(hole = holeRegex.exec(rawString)){
        if(hole.index > index){
          formattedString += rawString.substring(index, hole.index);
        }
        if(args[hole[1]]) {
          formattedString += args[hole[1]];
          index = hole.index + hole[0].length;
        } else {
          throw new i18nError.ArgNotFound("Arg: " + hole[1]);
        }
      }
      formattedString += rawString.substring(index);
      return formattedString;
    } else {
      return rawString;
    }
  } else {
    throw new i18nError.KeyNotFound("Key: " + key);
  }
}

var loadLocalizer = function(requestedLocale, defaultLocale, supportedLocales, resourceUrl){
  return Promise.try(function(){
    var targetLocale;
    if(!requestedLocale) {
      targetLocale = defaultLocale;
    } else {
      targetLocale = closestSupportedLocale(requestedLocale, defaultLocale, supportedLocales);
    }

    if(targetLocale === activeLocale && localizer){
      return localizer;
    }

    if(!loadOnce) {
      loadOnce = new Promise(function(resolve, reject) {
        var request = new XMLHttpRequest();

        request.open('GET', urlForLocale(resourceUrl, targetLocale), true);
        request.onload = function() {
          try {
            if(request.status === 200) {
              var resources = JSON.parse(request.responseText);
              localizer = {
                resourceDictionary: resources,
                localize: localize
              }
              activeLocale = targetLocale;
              return resolve(localizer);
            } else if(request.status === 404) {
              return reject(new i18nError.LocaleNotFound(targetLocale + " not found."));
            } else {
              return reject(new i18nError.Unknown("Unable to load locale, status: " + request.status));
            }
          } catch(ex) {
            return reject(new i18nError.Unknown(ex.message));
          }
        };
        request.send();
      });
    }
    return loadOnce;
  })
}

module.exports = {
  loadLocalizer: loadLocalizer
}

},{"./i18n-error":5,"bluebird":18}],7:[function(require,module,exports){
var arg = require('./util/arg');
var CallbackCache = require('./callback-cache')
var HostHandlers = require('./host-handlers');
var initi18n = require('./initialize-i18n');
var initIO = require('./initialize-io');
var PostMessageIO = require('post-message-io');
var processResult = require('./process-result');
var xtend = require('xtend');

var TrelloIFrame = function(options) {
  this.io = null;
  this.args = [{
    context: arg('context'),
    secret: arg('secret')
  }].concat(arg('args'));
  this.secret = arg('secret');
  window.locale = arg('locale');
  this.options = options;
};

TrelloIFrame.prototype.connect = function(){
  var handlers = {
    'callback': function(t, options) {
      return CallbackCache.callback.call(this, t, options, processResult);
    },
  };
  this.io = initIO(handlers, xtend(this.options, {
    secret: arg('secret'),
    hostHandlers: HostHandlers
  }));
};

TrelloIFrame.prototype.request = function(command, options) {
  return this.io.request(command, options);
}

TrelloIFrame.prototype.render = function(renderer) {
  var self = this;
  window.addEventListener('message', function(e){
    if(e.source === window.parent && e.data == 'render') {
      initi18n(window.locale, self.options)
      .then(function(){
        renderer();
      });
    }
  }, false)
}

TrelloIFrame.prototype.NotHandled = PostMessageIO.NotHandled;

var method;
for(method in HostHandlers) {
  if(HostHandlers.hasOwnProperty(method)){
    TrelloIFrame.prototype[method] = HostHandlers[method];
  }
}

module.exports = TrelloIFrame;

},{"./callback-cache":1,"./host-handlers":4,"./initialize-i18n":9,"./initialize-io":10,"./process-result":12,"./util/arg":13,"post-message-io":20,"xtend":22}],8:[function(require,module,exports){
var initi18n = require('./initialize-i18n');
var makeErrorEnum = require('./util/make-error-enum')
var PostMessageIO = require('post-message-io');
var Promise = require('bluebird');
var relativeUrl = require('./util/relative-url');
var TrelloPlugin = require('./plugin');
var TrelloIFrame = require('./iframe');

require('./compatibility/closest');

module.exports = {
  initialize: function(handlers, options) {
    var plugin = new TrelloPlugin(handlers, options);
    plugin.connect();
  },
  iframe: function(options) {
    var iframe = new TrelloIFrame(options);
    iframe.connect();
    return iframe;
  },
  PostMessageIO: PostMessageIO,
  Promise: Promise,
  util: {
    initLocalizer: initi18n,
    makeErrorEnum: makeErrorEnum,
    relativeUrl: relativeUrl
  }
};

},{"./compatibility/closest":3,"./iframe":7,"./initialize-i18n":9,"./plugin":11,"./util/make-error-enum":14,"./util/relative-url":15,"bluebird":18,"post-message-io":20}],9:[function(require,module,exports){
var i18n = require('./i18n');
var i18nError = require('./i18n-error');
var Promise = require('bluebird');

module.exports = function(locale, options) {
  options = options || {};

  if(!locale){
    return Promise.reject(new i18nError.LocaleNotSpecified("Unable to load a localizer without a locale"));
  }

  if(window.localizer){
    return Promise.resolve();
  } else if(options.localizer){
    window.localizer = options.localizer;
  } else if(options.loadLocalizer){
    if(typeof options.loadLocalizer === 'function'){
      return Promise.resolve(options.loadLocalizer(locale))
      .then(function(localizer){
        window.localizer = localizer;
        return Promise.resolve();
      });
    } else {
      return Promise.reject(new i18nError.LoadLocalizerNotAFunction("Specified loadLocalizer must be a function that returns a localizer or a Promise resolving to a localizer"));
    }
  } else if(options.localization){
    var i18nOpts = options.localization;
    if(!i18nOpts.defaultLocale){
      return Promise.reject(new i18nError.MissingDefaultLocale("Missing defaultLocale"));
    }
    if(!i18nOpts.supportedLocales){
      return Promise.reject(new i18nError.MissingSupportedLocales("Missing supportedLocales"));
    }
    if(!i18nOpts.resourceUrl){
      return Promise.reject(new i18nError.MissingResourceUrl("Missing resourceUrl"));
    }
    return i18n.loadLocalizer(locale, i18nOpts.defaultLocale, i18nOpts.supportedLocales, i18nOpts.resourceUrl)
    .then(function(localizer){
      window.localizer = localizer;
      return Promise.resolve();
    });
  }
  return Promise.resolve();
}

},{"./i18n":6,"./i18n-error":5,"bluebird":18}],10:[function(require,module,exports){
var PostMessageIO = require('post-message-io');

module.exports = function(handlers, options) {
  options = options || {};

  var io = new PostMessageIO({
    local: window,
    remote: window.parent,
    targetOrigin: options.targetOrigin || "https://trello.com",
    secret: options.secret,
    handlers: handlers,
    hostHandlers: options.hostHandlers
  });

  return io;
}

},{"post-message-io":20}],11:[function(require,module,exports){
var arg = require('./util/arg');
var CallbackCache = require('./callback-cache');
var HostHandlers = require('./host-handlers');
var initi18n = require('./initialize-i18n');
var initIO = require('./initialize-io');
var processResult = require('./process-result');
var PostMessageIO = require('post-message-io');
var Promise = require('bluebird');
var xtend = require('xtend');

var TrelloPlugin = function(handlers, options) {
  var self = this;
  this.io = null;
  this.handlers = {};
  Object.keys(handlers).forEach(function(command){
    self.handlers[command] = function(){
      var args = arguments;
      var self = this;
      window.locale = args[1].locale;
      return initi18n(window.locale, options)
      .then(function(){
        return Promise.try(function(){
          return handlers[command].apply(self, args);
        })
        .then(processResult);
      })
    }
  });
  this.handlers.callback = function(t, options) {
    return CallbackCache.callback.call(this, t, options, processResult);
  };
  this.options = options || {};
};

TrelloPlugin.prototype.connect = function(){
  var io = this.io = initIO(this.handlers, xtend(this.options, {
    secret: arg('secret'),
    hostHandlers: HostHandlers
  }));

  return io.request('initialize', Object.keys(this.handlers))
  .then(function(init){
    io.secret = init.secret;
    return io.request('ready');
  })
  .then(function(){
    return io;
  })
};

TrelloPlugin.prototype.NotHandled = PostMessageIO.NotHandled;

module.exports = TrelloPlugin;

},{"./callback-cache":1,"./host-handlers":4,"./initialize-i18n":9,"./initialize-io":10,"./process-result":12,"./util/arg":13,"bluebird":18,"post-message-io":20,"xtend":22}],12:[function(require,module,exports){
var CallbackCache = require('./callback-cache');

var relativeUrl = function(url) {
  // IE has no location.origin until IE11 ...
  var origin = location.origin || (location.protocol + '//' + location.host);
  return [origin, location.pathname.replace(/[^\/]+$/, ''), url].join('');
};

var process = function(value, key) {
  if(!value) {
    return value;
  }
  if((key == 'url' || key == 'icon') && typeof value == 'string'){
    if(value.indexOf("./") == 0) {
      return relativeUrl(value.substr(2));
    }
  }
  switch(typeof value){
    case 'object':
      if(Array.isArray(value)) {
        return value.map(process)
      } else {
        var processed = {};
        Object.keys(value).forEach(function(key){
          processed[key] = process(value[key], key);
        })
        return processed;
      }
    case 'function':
      return CallbackCache.serialize(value);
    default:
      return value;
  }
}

module.exports = process;

},{"./callback-cache":1}],13:[function(require,module,exports){
var hashData = null;

module.exports = function(key, defaultValue) {
  if(!hashData) {
    try {
      hashData = JSON.parse(decodeURIComponent(location.hash.replace(/^#/, '')));
    } catch (error) {
      hashData = {};
    }
  }
  if(hashData.hasOwnProperty(key)) {
    return hashData[key];
  } else {
    return defaultValue;
  }
}

},{}],14:[function(require,module,exports){
var CustomError = require('error-ext');

var reservedBaseName = "Error";

module.exports = function(namespace, names){
  var baseClass = new CustomError([namespace, reservedBaseName].join('::'));

  names.forEach(function(name){
    baseClass[name] = new CustomError([namespace, name].join('::'), {}, baseClass);
  });

  return baseClass;
};

},{"error-ext":19}],15:[function(require,module,exports){
module.exports = function (url) {
  if(/^https?:\/\//.test(url)) {
    return url;
  } else {
    return [
      location.protocol,
      '//',
      location.host,
      location.pathname.replace(/[^\/]+$/, ''),
      url
    ].join('');
  }
};

},{}],16:[function(require,module,exports){
module.exports = function(html) {
  return String(html === null ? "" : html)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

},{}],17:[function(require,module,exports){
module.exports = function(message) {
  if(window.console && typeof console.warn === "function"){
    console.warn(message);
  }
};

},{}],18:[function(require,module,exports){
(function (process,global){
/* @preserve
 * The MIT License (MIT)
 * 
 * Copyright (c) 2013-2015 Petka Antonov
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * 
 */
/**
 * bluebird build version 2.11.0
 * Features enabled: core, race, call_get, generators, map, nodeify, promisify, props, reduce, settle, some, cancel, using, filter, any, each, timers
*/
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.Promise=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof _dereq_=="function"&&_dereq_;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof _dereq_=="function"&&_dereq_;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise) {
var SomePromiseArray = Promise._SomePromiseArray;
function any(promises) {
    var ret = new SomePromiseArray(promises);
    var promise = ret.promise();
    ret.setHowMany(1);
    ret.setUnwrap();
    ret.init();
    return promise;
}

Promise.any = function (promises) {
    return any(promises);
};

Promise.prototype.any = function () {
    return any(this);
};

};

},{}],2:[function(_dereq_,module,exports){
"use strict";
var firstLineError;
try {throw new Error(); } catch (e) {firstLineError = e;}
var schedule = _dereq_("./schedule.js");
var Queue = _dereq_("./queue.js");
var util = _dereq_("./util.js");

function Async() {
    this._isTickUsed = false;
    this._lateQueue = new Queue(16);
    this._normalQueue = new Queue(16);
    this._trampolineEnabled = true;
    var self = this;
    this.drainQueues = function () {
        self._drainQueues();
    };
    this._schedule =
        schedule.isStatic ? schedule(this.drainQueues) : schedule;
}

Async.prototype.disableTrampolineIfNecessary = function() {
    if (util.hasDevTools) {
        this._trampolineEnabled = false;
    }
};

Async.prototype.enableTrampoline = function() {
    if (!this._trampolineEnabled) {
        this._trampolineEnabled = true;
        this._schedule = function(fn) {
            setTimeout(fn, 0);
        };
    }
};

Async.prototype.haveItemsQueued = function () {
    return this._normalQueue.length() > 0;
};

Async.prototype.throwLater = function(fn, arg) {
    if (arguments.length === 1) {
        arg = fn;
        fn = function () { throw arg; };
    }
    if (typeof setTimeout !== "undefined") {
        setTimeout(function() {
            fn(arg);
        }, 0);
    } else try {
        this._schedule(function() {
            fn(arg);
        });
    } catch (e) {
        throw new Error("No async scheduler available\u000a\u000a    See http://goo.gl/m3OTXk\u000a");
    }
};

function AsyncInvokeLater(fn, receiver, arg) {
    this._lateQueue.push(fn, receiver, arg);
    this._queueTick();
}

function AsyncInvoke(fn, receiver, arg) {
    this._normalQueue.push(fn, receiver, arg);
    this._queueTick();
}

function AsyncSettlePromises(promise) {
    this._normalQueue._pushOne(promise);
    this._queueTick();
}

if (!util.hasDevTools) {
    Async.prototype.invokeLater = AsyncInvokeLater;
    Async.prototype.invoke = AsyncInvoke;
    Async.prototype.settlePromises = AsyncSettlePromises;
} else {
    if (schedule.isStatic) {
        schedule = function(fn) { setTimeout(fn, 0); };
    }
    Async.prototype.invokeLater = function (fn, receiver, arg) {
        if (this._trampolineEnabled) {
            AsyncInvokeLater.call(this, fn, receiver, arg);
        } else {
            this._schedule(function() {
                setTimeout(function() {
                    fn.call(receiver, arg);
                }, 100);
            });
        }
    };

    Async.prototype.invoke = function (fn, receiver, arg) {
        if (this._trampolineEnabled) {
            AsyncInvoke.call(this, fn, receiver, arg);
        } else {
            this._schedule(function() {
                fn.call(receiver, arg);
            });
        }
    };

    Async.prototype.settlePromises = function(promise) {
        if (this._trampolineEnabled) {
            AsyncSettlePromises.call(this, promise);
        } else {
            this._schedule(function() {
                promise._settlePromises();
            });
        }
    };
}

Async.prototype.invokeFirst = function (fn, receiver, arg) {
    this._normalQueue.unshift(fn, receiver, arg);
    this._queueTick();
};

Async.prototype._drainQueue = function(queue) {
    while (queue.length() > 0) {
        var fn = queue.shift();
        if (typeof fn !== "function") {
            fn._settlePromises();
            continue;
        }
        var receiver = queue.shift();
        var arg = queue.shift();
        fn.call(receiver, arg);
    }
};

Async.prototype._drainQueues = function () {
    this._drainQueue(this._normalQueue);
    this._reset();
    this._drainQueue(this._lateQueue);
};

Async.prototype._queueTick = function () {
    if (!this._isTickUsed) {
        this._isTickUsed = true;
        this._schedule(this.drainQueues);
    }
};

Async.prototype._reset = function () {
    this._isTickUsed = false;
};

module.exports = new Async();
module.exports.firstLineError = firstLineError;

},{"./queue.js":28,"./schedule.js":31,"./util.js":38}],3:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise, INTERNAL, tryConvertToPromise) {
var rejectThis = function(_, e) {
    this._reject(e);
};

var targetRejected = function(e, context) {
    context.promiseRejectionQueued = true;
    context.bindingPromise._then(rejectThis, rejectThis, null, this, e);
};

var bindingResolved = function(thisArg, context) {
    if (this._isPending()) {
        this._resolveCallback(context.target);
    }
};

var bindingRejected = function(e, context) {
    if (!context.promiseRejectionQueued) this._reject(e);
};

Promise.prototype.bind = function (thisArg) {
    var maybePromise = tryConvertToPromise(thisArg);
    var ret = new Promise(INTERNAL);
    ret._propagateFrom(this, 1);
    var target = this._target();

    ret._setBoundTo(maybePromise);
    if (maybePromise instanceof Promise) {
        var context = {
            promiseRejectionQueued: false,
            promise: ret,
            target: target,
            bindingPromise: maybePromise
        };
        target._then(INTERNAL, targetRejected, ret._progress, ret, context);
        maybePromise._then(
            bindingResolved, bindingRejected, ret._progress, ret, context);
    } else {
        ret._resolveCallback(target);
    }
    return ret;
};

Promise.prototype._setBoundTo = function (obj) {
    if (obj !== undefined) {
        this._bitField = this._bitField | 131072;
        this._boundTo = obj;
    } else {
        this._bitField = this._bitField & (~131072);
    }
};

Promise.prototype._isBound = function () {
    return (this._bitField & 131072) === 131072;
};

Promise.bind = function (thisArg, value) {
    var maybePromise = tryConvertToPromise(thisArg);
    var ret = new Promise(INTERNAL);

    ret._setBoundTo(maybePromise);
    if (maybePromise instanceof Promise) {
        maybePromise._then(function() {
            ret._resolveCallback(value);
        }, ret._reject, ret._progress, ret, null);
    } else {
        ret._resolveCallback(value);
    }
    return ret;
};
};

},{}],4:[function(_dereq_,module,exports){
"use strict";
var old;
if (typeof Promise !== "undefined") old = Promise;
function noConflict() {
    try { if (Promise === bluebird) Promise = old; }
    catch (e) {}
    return bluebird;
}
var bluebird = _dereq_("./promise.js")();
bluebird.noConflict = noConflict;
module.exports = bluebird;

},{"./promise.js":23}],5:[function(_dereq_,module,exports){
"use strict";
var cr = Object.create;
if (cr) {
    var callerCache = cr(null);
    var getterCache = cr(null);
    callerCache[" size"] = getterCache[" size"] = 0;
}

module.exports = function(Promise) {
var util = _dereq_("./util.js");
var canEvaluate = util.canEvaluate;
var isIdentifier = util.isIdentifier;

var getMethodCaller;
var getGetter;
if (!true) {
var makeMethodCaller = function (methodName) {
    return new Function("ensureMethod", "                                    \n\
        return function(obj) {                                               \n\
            'use strict'                                                     \n\
            var len = this.length;                                           \n\
            ensureMethod(obj, 'methodName');                                 \n\
            switch(len) {                                                    \n\
                case 1: return obj.methodName(this[0]);                      \n\
                case 2: return obj.methodName(this[0], this[1]);             \n\
                case 3: return obj.methodName(this[0], this[1], this[2]);    \n\
                case 0: return obj.methodName();                             \n\
                default:                                                     \n\
                    return obj.methodName.apply(obj, this);                  \n\
            }                                                                \n\
        };                                                                   \n\
        ".replace(/methodName/g, methodName))(ensureMethod);
};

var makeGetter = function (propertyName) {
    return new Function("obj", "                                             \n\
        'use strict';                                                        \n\
        return obj.propertyName;                                             \n\
        ".replace("propertyName", propertyName));
};

var getCompiled = function(name, compiler, cache) {
    var ret = cache[name];
    if (typeof ret !== "function") {
        if (!isIdentifier(name)) {
            return null;
        }
        ret = compiler(name);
        cache[name] = ret;
        cache[" size"]++;
        if (cache[" size"] > 512) {
            var keys = Object.keys(cache);
            for (var i = 0; i < 256; ++i) delete cache[keys[i]];
            cache[" size"] = keys.length - 256;
        }
    }
    return ret;
};

getMethodCaller = function(name) {
    return getCompiled(name, makeMethodCaller, callerCache);
};

getGetter = function(name) {
    return getCompiled(name, makeGetter, getterCache);
};
}

function ensureMethod(obj, methodName) {
    var fn;
    if (obj != null) fn = obj[methodName];
    if (typeof fn !== "function") {
        var message = "Object " + util.classString(obj) + " has no method '" +
            util.toString(methodName) + "'";
        throw new Promise.TypeError(message);
    }
    return fn;
}

function caller(obj) {
    var methodName = this.pop();
    var fn = ensureMethod(obj, methodName);
    return fn.apply(obj, this);
}
Promise.prototype.call = function (methodName) {
    var $_len = arguments.length;var args = new Array($_len - 1); for(var $_i = 1; $_i < $_len; ++$_i) {args[$_i - 1] = arguments[$_i];}
    if (!true) {
        if (canEvaluate) {
            var maybeCaller = getMethodCaller(methodName);
            if (maybeCaller !== null) {
                return this._then(
                    maybeCaller, undefined, undefined, args, undefined);
            }
        }
    }
    args.push(methodName);
    return this._then(caller, undefined, undefined, args, undefined);
};

function namedGetter(obj) {
    return obj[this];
}
function indexedGetter(obj) {
    var index = +this;
    if (index < 0) index = Math.max(0, index + obj.length);
    return obj[index];
}
Promise.prototype.get = function (propertyName) {
    var isIndex = (typeof propertyName === "number");
    var getter;
    if (!isIndex) {
        if (canEvaluate) {
            var maybeGetter = getGetter(propertyName);
            getter = maybeGetter !== null ? maybeGetter : namedGetter;
        } else {
            getter = namedGetter;
        }
    } else {
        getter = indexedGetter;
    }
    return this._then(getter, undefined, undefined, propertyName, undefined);
};
};

},{"./util.js":38}],6:[function(_dereq_,module,exports){
"use strict";
module.exports = function(Promise) {
var errors = _dereq_("./errors.js");
var async = _dereq_("./async.js");
var CancellationError = errors.CancellationError;

Promise.prototype._cancel = function (reason) {
    if (!this.isCancellable()) return this;
    var parent;
    var promiseToReject = this;
    while ((parent = promiseToReject._cancellationParent) !== undefined &&
        parent.isCancellable()) {
        promiseToReject = parent;
    }
    this._unsetCancellable();
    promiseToReject._target()._rejectCallback(reason, false, true);
};

Promise.prototype.cancel = function (reason) {
    if (!this.isCancellable()) return this;
    if (reason === undefined) reason = new CancellationError();
    async.invokeLater(this._cancel, this, reason);
    return this;
};

Promise.prototype.cancellable = function () {
    if (this._cancellable()) return this;
    async.enableTrampoline();
    this._setCancellable();
    this._cancellationParent = undefined;
    return this;
};

Promise.prototype.uncancellable = function () {
    var ret = this.then();
    ret._unsetCancellable();
    return ret;
};

Promise.prototype.fork = function (didFulfill, didReject, didProgress) {
    var ret = this._then(didFulfill, didReject, didProgress,
                         undefined, undefined);

    ret._setCancellable();
    ret._cancellationParent = undefined;
    return ret;
};
};

},{"./async.js":2,"./errors.js":13}],7:[function(_dereq_,module,exports){
"use strict";
module.exports = function() {
var async = _dereq_("./async.js");
var util = _dereq_("./util.js");
var bluebirdFramePattern =
    /[\\\/]bluebird[\\\/]js[\\\/](main|debug|zalgo|instrumented)/;
var stackFramePattern = null;
var formatStack = null;
var indentStackFrames = false;
var warn;

function CapturedTrace(parent) {
    this._parent = parent;
    var length = this._length = 1 + (parent === undefined ? 0 : parent._length);
    captureStackTrace(this, CapturedTrace);
    if (length > 32) this.uncycle();
}
util.inherits(CapturedTrace, Error);

CapturedTrace.prototype.uncycle = function() {
    var length = this._length;
    if (length < 2) return;
    var nodes = [];
    var stackToIndex = {};

    for (var i = 0, node = this; node !== undefined; ++i) {
        nodes.push(node);
        node = node._parent;
    }
    length = this._length = i;
    for (var i = length - 1; i >= 0; --i) {
        var stack = nodes[i].stack;
        if (stackToIndex[stack] === undefined) {
            stackToIndex[stack] = i;
        }
    }
    for (var i = 0; i < length; ++i) {
        var currentStack = nodes[i].stack;
        var index = stackToIndex[currentStack];
        if (index !== undefined && index !== i) {
            if (index > 0) {
                nodes[index - 1]._parent = undefined;
                nodes[index - 1]._length = 1;
            }
            nodes[i]._parent = undefined;
            nodes[i]._length = 1;
            var cycleEdgeNode = i > 0 ? nodes[i - 1] : this;

            if (index < length - 1) {
                cycleEdgeNode._parent = nodes[index + 1];
                cycleEdgeNode._parent.uncycle();
                cycleEdgeNode._length =
                    cycleEdgeNode._parent._length + 1;
            } else {
                cycleEdgeNode._parent = undefined;
                cycleEdgeNode._length = 1;
            }
            var currentChildLength = cycleEdgeNode._length + 1;
            for (var j = i - 2; j >= 0; --j) {
                nodes[j]._length = currentChildLength;
                currentChildLength++;
            }
            return;
        }
    }
};

CapturedTrace.prototype.parent = function() {
    return this._parent;
};

CapturedTrace.prototype.hasParent = function() {
    return this._parent !== undefined;
};

CapturedTrace.prototype.attachExtraTrace = function(error) {
    if (error.__stackCleaned__) return;
    this.uncycle();
    var parsed = CapturedTrace.parseStackAndMessage(error);
    var message = parsed.message;
    var stacks = [parsed.stack];

    var trace = this;
    while (trace !== undefined) {
        stacks.push(cleanStack(trace.stack.split("\n")));
        trace = trace._parent;
    }
    removeCommonRoots(stacks);
    removeDuplicateOrEmptyJumps(stacks);
    util.notEnumerableProp(error, "stack", reconstructStack(message, stacks));
    util.notEnumerableProp(error, "__stackCleaned__", true);
};

function reconstructStack(message, stacks) {
    for (var i = 0; i < stacks.length - 1; ++i) {
        stacks[i].push("From previous event:");
        stacks[i] = stacks[i].join("\n");
    }
    if (i < stacks.length) {
        stacks[i] = stacks[i].join("\n");
    }
    return message + "\n" + stacks.join("\n");
}

function removeDuplicateOrEmptyJumps(stacks) {
    for (var i = 0; i < stacks.length; ++i) {
        if (stacks[i].length === 0 ||
            ((i + 1 < stacks.length) && stacks[i][0] === stacks[i+1][0])) {
            stacks.splice(i, 1);
            i--;
        }
    }
}

function removeCommonRoots(stacks) {
    var current = stacks[0];
    for (var i = 1; i < stacks.length; ++i) {
        var prev = stacks[i];
        var currentLastIndex = current.length - 1;
        var currentLastLine = current[currentLastIndex];
        var commonRootMeetPoint = -1;

        for (var j = prev.length - 1; j >= 0; --j) {
            if (prev[j] === currentLastLine) {
                commonRootMeetPoint = j;
                break;
            }
        }

        for (var j = commonRootMeetPoint; j >= 0; --j) {
            var line = prev[j];
            if (current[currentLastIndex] === line) {
                current.pop();
                currentLastIndex--;
            } else {
                break;
            }
        }
        current = prev;
    }
}

function cleanStack(stack) {
    var ret = [];
    for (var i = 0; i < stack.length; ++i) {
        var line = stack[i];
        var isTraceLine = stackFramePattern.test(line) ||
            "    (No stack trace)" === line;
        var isInternalFrame = isTraceLine && shouldIgnore(line);
        if (isTraceLine && !isInternalFrame) {
            if (indentStackFrames && line.charAt(0) !== " ") {
                line = "    " + line;
            }
            ret.push(line);
        }
    }
    return ret;
}

function stackFramesAsArray(error) {
    var stack = error.stack.replace(/\s+$/g, "").split("\n");
    for (var i = 0; i < stack.length; ++i) {
        var line = stack[i];
        if ("    (No stack trace)" === line || stackFramePattern.test(line)) {
            break;
        }
    }
    if (i > 0) {
        stack = stack.slice(i);
    }
    return stack;
}

CapturedTrace.parseStackAndMessage = function(error) {
    var stack = error.stack;
    var message = error.toString();
    stack = typeof stack === "string" && stack.length > 0
                ? stackFramesAsArray(error) : ["    (No stack trace)"];
    return {
        message: message,
        stack: cleanStack(stack)
    };
};

CapturedTrace.formatAndLogError = function(error, title) {
    if (typeof console !== "undefined") {
        var message;
        if (typeof error === "object" || typeof error === "function") {
            var stack = error.stack;
            message = title + formatStack(stack, error);
        } else {
            message = title + String(error);
        }
        if (typeof warn === "function") {
            warn(message);
        } else if (typeof console.log === "function" ||
            typeof console.log === "object") {
            console.log(message);
        }
    }
};

CapturedTrace.unhandledRejection = function (reason) {
    CapturedTrace.formatAndLogError(reason, "^--- With additional stack trace: ");
};

CapturedTrace.isSupported = function () {
    return typeof captureStackTrace === "function";
};

CapturedTrace.fireRejectionEvent =
function(name, localHandler, reason, promise) {
    var localEventFired = false;
    try {
        if (typeof localHandler === "function") {
            localEventFired = true;
            if (name === "rejectionHandled") {
                localHandler(promise);
            } else {
                localHandler(reason, promise);
            }
        }
    } catch (e) {
        async.throwLater(e);
    }

    var globalEventFired = false;
    try {
        globalEventFired = fireGlobalEvent(name, reason, promise);
    } catch (e) {
        globalEventFired = true;
        async.throwLater(e);
    }

    var domEventFired = false;
    if (fireDomEvent) {
        try {
            domEventFired = fireDomEvent(name.toLowerCase(), {
                reason: reason,
                promise: promise
            });
        } catch (e) {
            domEventFired = true;
            async.throwLater(e);
        }
    }

    if (!globalEventFired && !localEventFired && !domEventFired &&
        name === "unhandledRejection") {
        CapturedTrace.formatAndLogError(reason, "Unhandled rejection ");
    }
};

function formatNonError(obj) {
    var str;
    if (typeof obj === "function") {
        str = "[function " +
            (obj.name || "anonymous") +
            "]";
    } else {
        str = obj.toString();
        var ruselessToString = /\[object [a-zA-Z0-9$_]+\]/;
        if (ruselessToString.test(str)) {
            try {
                var newStr = JSON.stringify(obj);
                str = newStr;
            }
            catch(e) {

            }
        }
        if (str.length === 0) {
            str = "(empty array)";
        }
    }
    return ("(<" + snip(str) + ">, no stack trace)");
}

function snip(str) {
    var maxChars = 41;
    if (str.length < maxChars) {
        return str;
    }
    return str.substr(0, maxChars - 3) + "...";
}

var shouldIgnore = function() { return false; };
var parseLineInfoRegex = /[\/<\(]([^:\/]+):(\d+):(?:\d+)\)?\s*$/;
function parseLineInfo(line) {
    var matches = line.match(parseLineInfoRegex);
    if (matches) {
        return {
            fileName: matches[1],
            line: parseInt(matches[2], 10)
        };
    }
}
CapturedTrace.setBounds = function(firstLineError, lastLineError) {
    if (!CapturedTrace.isSupported()) return;
    var firstStackLines = firstLineError.stack.split("\n");
    var lastStackLines = lastLineError.stack.split("\n");
    var firstIndex = -1;
    var lastIndex = -1;
    var firstFileName;
    var lastFileName;
    for (var i = 0; i < firstStackLines.length; ++i) {
        var result = parseLineInfo(firstStackLines[i]);
        if (result) {
            firstFileName = result.fileName;
            firstIndex = result.line;
            break;
        }
    }
    for (var i = 0; i < lastStackLines.length; ++i) {
        var result = parseLineInfo(lastStackLines[i]);
        if (result) {
            lastFileName = result.fileName;
            lastIndex = result.line;
            break;
        }
    }
    if (firstIndex < 0 || lastIndex < 0 || !firstFileName || !lastFileName ||
        firstFileName !== lastFileName || firstIndex >= lastIndex) {
        return;
    }

    shouldIgnore = function(line) {
        if (bluebirdFramePattern.test(line)) return true;
        var info = parseLineInfo(line);
        if (info) {
            if (info.fileName === firstFileName &&
                (firstIndex <= info.line && info.line <= lastIndex)) {
                return true;
            }
        }
        return false;
    };
};

var captureStackTrace = (function stackDetection() {
    var v8stackFramePattern = /^\s*at\s*/;
    var v8stackFormatter = function(stack, error) {
        if (typeof stack === "string") return stack;

        if (error.name !== undefined &&
            error.message !== undefined) {
            return error.toString();
        }
        return formatNonError(error);
    };

    if (typeof Error.stackTraceLimit === "number" &&
        typeof Error.captureStackTrace === "function") {
        Error.stackTraceLimit = Error.stackTraceLimit + 6;
        stackFramePattern = v8stackFramePattern;
        formatStack = v8stackFormatter;
        var captureStackTrace = Error.captureStackTrace;

        shouldIgnore = function(line) {
            return bluebirdFramePattern.test(line);
        };
        return function(receiver, ignoreUntil) {
            Error.stackTraceLimit = Error.stackTraceLimit + 6;
            captureStackTrace(receiver, ignoreUntil);
            Error.stackTraceLimit = Error.stackTraceLimit - 6;
        };
    }
    var err = new Error();

    if (typeof err.stack === "string" &&
        err.stack.split("\n")[0].indexOf("stackDetection@") >= 0) {
        stackFramePattern = /@/;
        formatStack = v8stackFormatter;
        indentStackFrames = true;
        return function captureStackTrace(o) {
            o.stack = new Error().stack;
        };
    }
