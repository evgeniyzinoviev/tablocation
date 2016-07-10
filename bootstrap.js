const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import('resource://gre/modules/devtools/Console.jsm');
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

var consoleService = Cc["@mozilla.org/consoleservice;1"]
    .getService(Ci.nsIConsoleService);
var wm = Cc["@mozilla.org/appshell/window-mediator;1"]
    .getService(Ci.nsIWindowMediator);
var prefs = Cc["@mozilla.org/preferences-service;1"]
    .getService(Ci.nsIPrefService)
    .getBranch("extensions.tablocation.");
var styleSheetService = Cc["@mozilla.org/content/style-sheet-service;1"]
    .getService(Ci.nsIStyleSheetService);

var styleSheets = {
  common: ["chrome://tablocation/skin/overlay.css"],
  smaller: ["chrome://tablocation/skin/overlay-small.css"],
  bold: ["chrome://tablocation/skin/overlay-bold.css"]
};

var LocationPreference = 0;
var SmallerPreference = false;
var BoldPreference = false;

var Controller = {
  bindWindowEvents: function(chromeWindow) {
    if (chromeWindow._tabLocationBind) {
      LOG("chromeWindow._tabLocationBind == true");
      return;
    }

    chromeWindow._tabLocationBind = true;
    var gBrowser = chromeWindow.gBrowser;
    gBrowser.addEventListener('load', Controller.windowLoadListener, true);
    //gBrowser.addEventListener('readystatechange', Controller.windowLoadListener, true);
    gBrowser.addEventListener('DOMTitleChanged', Controller.tabsTitleChangedListener, true);
    gBrowser.addTabsProgressListener(Controller.tabsProgressListener);

    var container = gBrowser.tabContainer;
    container.addEventListener("TabOpen", Controller.tabOpenListener, false);
    container.addEventListener("TabMove", Controller.tabMoveListener);
    container.addEventListener("TabClose", Controller.tabCloseListener);
  },
  unbindWindowEvents: function(chromeWindow) {
    var gBrowser = chromeWindow.gBrowser;
    gBrowser.removeEventListener('load', Controller.windowLoadListener, true);
    //gBrowser.removeEventListener('readystatechange', Controller.windowLoadListener, true);
    gBrowser.removeEventListener('DOMTitleChanged', Controller.tabsTitleChangedListener, true);
    gBrowser.removeTabsProgressListener(Controller.tabsProgressListener);

    var container = gBrowser.tabContainer;
    container.removeEventListener("TabOpen", Controller.tabOpenListener);
    container.removeEventListener("TabMove", Controller.tabMoveListener);
    container.removeEventListener("TabClose", Controller.tabCloseListener);

    delete chromeWindow._tabLocationBind;
  },

  // Listeners
  windowLoadListener: function(e) {
    Controller.setupWindow(this.ownerGlobal);
  },
  tabOpenListener: function(e) {
    var chromeWindow = e.target.ownerGlobal;
    var browser = chromeWindow.gBrowser.getBrowserForTab(e.target);
    var index = chromeWindow.gBrowser.getBrowserIndexForDocument(browser.contentDocument);
    if (index != -1) {
      Controller.setupTab(chromeWindow, index);
    }
  },
  tabMoveListener: function(e) {
    var chromeWindow = e.target.ownerGlobal;
    var browser = chromeWindow.gBrowser.getBrowserForTab(e.target);
    var index = chromeWindow.gBrowser.getBrowserIndexForDocument(browser.contentDocument);
    if (index != -1) {
      Controller.setupTab(chromeWindow, index, true);
    }
  },
  tabCloseListener: function(e) {
    var chromeWindow = e.target.ownerGlobal;
    var browser = chromeWindow.gBrowser.getBrowserForTab(e.target);
    var index = chromeWindow.gBrowser.getBrowserIndexForDocument(browser.contentDocument);
    if (index != -1) {
      //LOG("tabCloseListener: tearing tab down");
      Controller.tearDownTab(chromeWindow, index, true);
    }
  },
  tabsProgressListener: {
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener, Ci.nsISupportsWeakReference]),
    onLocationChange: function(aBrowser, aProgress, aRequest, aURI) {
      var chromeWindow = aBrowser.ownerGlobal;
      var index = chromeWindow.gBrowser.getBrowserIndexForDocument(aBrowser.contentDocument);
      if (index == -1) {
        //LOG("Controller.tabsProgressListener()->onLocationChange(): index == -1");
        return;
      }
      Controller.updateLocation(chromeWindow, index);
    }
  },
  tabsTitleChangedListener: function(e) {
    var chromeWindow = this.ownerGlobal;
    var index = chromeWindow.gBrowser.getBrowserIndexForDocument(e.target);
    var browser = chromeWindow.gBrowser.browsers[index];
    if (index == -1 || !browser._tabLocationPatched || (e.target.title == '' && browser.contentDocument.documentURI == 'about:blank')) {
      return;
    }
    Controller.updateTitle(chromeWindow, index);
  },

  // UI functions
  setupWindow: function(chromeWindow) {
    var tabsCount = chromeWindow.gBrowser.browsers.length;
    for (var i = 0; i < tabsCount; i++) {
      Controller.setupTab(chromeWindow, i);
    }
  },
  setupTab: function(chromeWindow, tabIndex, force) {
    var browser = chromeWindow.gBrowser.browsers[tabIndex];
    if (browser._tabLocationPatched && !force) {
      //LOG("ignore(already) setupTab "+tabIndex);
      return true;
    }

    //if (browser.contentDocument.readyState == 'uninitialized') {
      //LOG("ignore(notready) setupTab "+tabIndex+",readyState:"+browser.contentDocument.readyState);
    //  return false;
    //}

    //LOG("setupTab:"+tabIndex+",readyState:"+browser.contentDocument.readyState);
    var ownerDocument = chromeWindow.gBrowser.ownerDocument;

    // Current location and title
    var loc = getLocation(browser.contentDocument.location), title = browser.contentDocument.title;

    // Get some elements
    var tab = chromeWindow.gBrowser.tabContainer.childNodes[tabIndex];
    var label = ownerDocument.getAnonymousElementByAttribute(tab, 'class', 'tab-text tab-label');

    // DOM manipulations
    var vbox = createElement(ownerDocument, 'xul:vbox', { orient: 'vertical', flex: 1, anonid: 'tab-label-vbox' });
    vbox.addEventListener('DOMAttrModified', function(e) {
      if (e.target != vbox/* && e.target != vbox.firstChild*/) {
        //LOG("e.target("+e.target.className+") != vbox [ "+e.attrName+" => "+e.newValue+" ]");
        return;
      }
      label.setAttribute(e.attrName, e.newValue);
      if (tabIndex == 1) {
        LOG("DOMAttrModified set " + e.attrName + "=" + e.newValue);
      }
    });
    var url = createElement(ownerDocument, 'label', {
      'class':        'tab-text tab-url-label',
      'xbl:inherits': 'value=visibleLabel,crop,accesskey,fadein,pinned,selected',
      'flex':         '1',
      //'anonid':       'tab-url-label',
      'role':         'presentation',
      'fadein':       'true',
      'selected':     'true',
      'crop':         'end'
    });
    url.setAttribute('value', loc);

    label.parentNode.insertBefore(vbox, label);

    vbox.appendChild(label);
    vbox.appendChild(url);

    browser._tabLocationPatched = true;

    return true;
  },
  updateAllLocations: function() {
    var windows = wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
      var chromeWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
      var tabsCount = chromeWindow.gBrowser.browsers.length;
      for (var i = 0; i < tabsCount; i++) {
        Controller.updateLocation(chromeWindow, i);
      }
    }
  },
  updateLocation: function(chromeWindow, tabIndex) {
    var ownerDocument = chromeWindow.gBrowser.ownerDocument;
    var loc = getLocation(chromeWindow.gBrowser.browsers[tabIndex].contentDocument.location);
    var tab = chromeWindow.gBrowser.tabContainer.childNodes[tabIndex];
    var url = ownerDocument.getAnonymousElementByAttribute(tab, 'class', 'tab-text tab-url-label');
    if (url) {
      url.setAttribute('value', loc);
    }
  },
  updateTitle: function(chromeWindow, tabIndex) {
    var ownerDocument = chromeWindow.gBrowser.ownerDocument;
    var title = chromeWindow.gBrowser.browsers[tabIndex].contentDocument.title;
    var tab = chromeWindow.gBrowser.tabContainer.childNodes[tabIndex];
    var label = ownerDocument.getAnonymousElementByAttribute(tab, 'anonid', 'tab-label');
    if (label) {
      label.setAttribute('value', title);
    }
  },
  tearDownWindow: function(chromeWindow) {
    var tabsCount = chromeWindow.gBrowser.browsers.length;
    for (var i = 0; i < tabsCount; i++) {
      Controller.tearDownTab(chromeWindow, i);
    }
  },
  tearDownTab: function(chromeWindow, tabIndex) {
    var browser = chromeWindow.gBrowser.browsers[tabIndex];
    if (!browser._tabLocationPatched) {
      //LOG("Controller.tearDownTab() not set up", chromeWindow, tabIndex);
      return;
    }
    var ownerDocument = chromeWindow.gBrowser.ownerDocument;

    var tab = chromeWindow.gBrowser.tabContainer.childNodes[tabIndex];
    var vbox = ownerDocument.getAnonymousElementByAttribute(tab, 'anonid', 'tab-label-vbox');
    //LOG("tearDownTab(): deleting vbox now", vbox);
    vbox.parentNode.insertBefore(vbox.firstChild, vbox);
    vbox.parentNode.removeChild(vbox);

    delete browser._tabLocationPatched;
  },

  loadStyles: function(list) {
    for (var i = 0, len = list.length; i < len; i++) {
      var styleSheetURI = Services.io.newURI(list[i], null, null);
      styleSheetService.loadAndRegisterSheet(styleSheetURI, styleSheetService.AUTHOR_SHEET);
    }
  },
  unloadStyles: function(list) {
    for (var i = 0, len = list.length; i < len; i++) {
      var styleSheetURI = Services.io.newURI(list[i], null, null);
      if (styleSheetService.sheetRegistered(styleSheetURI, styleSheetService.AUTHOR_SHEET)) {
          styleSheetService.unregisterSheet(styleSheetURI, styleSheetService.AUTHOR_SHEET);
      }
    }
  }
};

var PrefsObserver = {
  observe: function(subject, topic, data) {
    if (topic != "nsPref:changed") {
      return;
    }
    switch (data) {
      case "location":
        this.updateLocationPreference();
        break;
      case "smaller":
        this.updateSmallerPreference();
        break;
      case "bold":
        this.updateBoldPreference();
        break;
    }
  },
  updateLocationPreference: function() {
    var val = prefs.getIntPref("location");
    if (val != 0 && val != 1) {
      val = 0;
    }
    var prev = LocationPreference;
    LocationPreference = val;
    if (val != prev) {
      Controller.updateAllLocations();
    }
  },
  updateSmallerPreference: function() {
    var val = prefs.getBoolPref("smaller");
    var prev = SmallerPreference;
    SmallerPreference = val;
    if (val != prev) {
      Controller[val ? 'loadStyles' : 'unloadStyles'](styleSheets.smaller);
    }
  },
  updateBoldPreference: function() {
    var val = prefs.getBoolPref("bold");
    var prev = BoldPreference;
    BoldPreference = val;
    if (val != prev) {
      Controller[val ? 'loadStyles' : 'unloadStyles'](styleSheets.bold);
    }
  }
};

var WindowListener = {
  onOpenWindow: function(xulWindow) {
    //LOG("WindowListener.onOpenWindow()");
    var chromeWindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                         .getInterface(Ci.nsIDOMWindow);
    chromeWindow.addEventListener("load", function listener() {
      chromeWindow.removeEventListener("load", listener, false);
      var domDocument = chromeWindow.document.documentElement;
      var windowType = domDocument.getAttribute("windowtype");
      if (windowType == "navigator:browser") {
        Controller.bindWindowEvents(chromeWindow);
        //Controller.setupWindow(chromeWindow);
      }
    }, false);
  },
  onCloseWindow: function(chromeWindow) {
    // This is not necessary, window will be destroyed anyway..
    Controller.tearDownWindow(chromeWindow);
    Controller.unbindWindowEvents(chromeWindow);
  },
  onWindowTitleChange: function(chromeWindow, newTitle) {
    //LOG("onWindowTitleChange()", chromeWindow, newTitle);
  }
};

function startup(data, reason) {
  try {
    // Load stylesheets
    Controller.loadStyles(styleSheets.common);

    // Setup UI
    wm.addListener(WindowListener);
    if (reason != APP_STARTUP) {
      var windows = wm.getEnumerator("navigator:browser");
      while (windows.hasMoreElements()) {
        var chromeWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
        var readyState = chromeWindow.document.readyState;
        
        Controller.bindWindowEvents(chromeWindow);
        if (readyState == 'complete') {
          Controller.setupWindow(chromeWindow);
        }
      }
    }

    // Register to receive notifications of preference changes
    prefs.QueryInterface(Ci.nsIPrefBranch2);
    prefs.addObserver("", PrefsObserver, false);

    PrefsObserver.updateLocationPreference();
    PrefsObserver.updateSmallerPreference();
    PrefsObserver.updateBoldPreference();
  } catch (e) {
    LOG("startup() error:", e.message, e.stack);
  }
}
function shutdown(data, reason) {
  if (reason == APP_SHUTDOWN) {
    return;
  }

  // Unload stylesheets
  Controller.unloadStyles(styleSheets.common);
  if (SmallerPreference) Controller.unloadStyles(styleSheets.smaller);
  if (BoldPreference) Controller.unloadStyles(styleSheets.bold);

  // UI
  var windows = wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    var chromeWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    Controller.tearDownWindow(chromeWindow);
    Controller.unbindWindowEvents(chromeWindow);
  }

  // Remove prefs observer
  prefs.removeObserver("", PrefsObserver);

  if (reason == ADDON_DISABLE) {
    Services.obs.notifyObservers(null, "startupcache-invalidate", null);
    Services.obs.notifyObservers(null, "chrome-flush-caches", null);
  }
}
function install(data, reason) {
  try {
    prefs.getIntPref('location');
  } catch (e) {
    prefs.setIntPref('location', 0);
    prefs.setBoolPref('smaller', false);
    prefs.setBoolPref('bold', false);
  }
}
function uninstall(data, reason) {
  prefs.deleteBranch("");
}

function LOG() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift("tablocation:");
  console.log.apply(console, args);
}
function createElement(doc, name, attr) {
  var el = doc.createElement(name);
  for (var k in attr) {
    if (attr.hasOwnProperty(k)) {
      el.setAttribute(k, attr[k]);
    }
  }
  return el;
}
function getLocation(loc) {
  switch (LocationPreference) {
    case 0:
      loc = loc.href;
      break;

    case 1:
      if (loc.host) {
        loc = loc.host;
      } else {
        loc = loc.href;
      }
      break;
  }
  return loc;
}
