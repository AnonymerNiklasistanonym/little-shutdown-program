/**
 * Main script of the application littel-shutdown-program
 *
 * @summary handles the app start/close, main process, windows, ...
 * @author AnonymerNiklasistanyonym, undefinedCoding
 */

/* =====  Imports  ====== */

const {
  app, BrowserWindow, dialog, ipcMain, Menu, net, shell, Tray
} = require('electron')
const path = require('path')
const settings = require('./js/settings')
const url = require('url')

// global variables
var alreadyCheckingForUpdates = false
var mainWindow = null

// singelton implementation: only one instance of the program should run
if (!app.requestSingleInstanceLock()) app.quit()

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// setup of the settings with file name and default values
settings.setup('user-preferences', {
  checkForNewVersionOnStartup: true,
  mainColor: '#c9329e',
  mainColorText: 'white',
  nativeTitleBar: false,
  shutdown: true,
  tag: 'v' + app.getVersion(),
  timeInput: {
    d: '', h: '', m: '', s: ''
  },
  titlebarColorTextIcon: 'white',
  touchGestures: true,
  tray: false,
  windowBounds: {
    height: 600, width: 600, x: 0, y: 0
  }
})

/**
 * Check for a new version
 */
const checkForNewVersion = () => {
  // if there currently is no version check
  if (alreadyCheckingForUpdates) return
  // else block this function until it is finished
  alreadyCheckingForUpdates = true
  // create a buffer in which all the chunks of data will be saved
  let responseDataBuffer = []
  // make a request to the github api about the latest release
  net.request('https://api.github.com/repos/undefinedCoding/little-shutdown-program/releases/latest'
  ).on('response', response => {
    response.on('data', chunk => {
      // push gotten reponse chunk data into the buffer
      responseDataBuffer.push(chunk)
    }).on('end', () => {
      // until there is no more response data - then concat everything in the buffer
      const jsonObjectString = Buffer.concat(responseDataBuffer).toString()
      // dereference the buffer
      responseDataBuffer = null
      // try to parse the response data into an json object
      try {
        const latestRelease = JSON.parse(jsonObjectString)
        // get current tag
        const currentTag = settings.get('tag')
        // if the tags are different
        if (latestRelease.tag_name !== currentTag) {
          // send information to the renderer process
          mainWindow.webContents.send(
            'newVersionDetected',
            {
              tag: latestRelease.tag_name,
              url: latestRelease.html_url
            }
          )
          // show a message box that says that a new version is aviablee
          dialog.showMessageBox(
            mainWindow,
            {
              buttons: [ 'OK', 'NO', 'DISABLE NOTIFICATION' ],
              detail: `Installed: ${currentTag}, Latest: ${latestRelease.tag_name}`,
              message: 'Do you want to install the new version?',
              title: 'New version avaible',
              type: 'info'
            }).then(buttonId => {
            switch (buttonId.response) {
            case 0: // OK -> Open release website
              shell.openExternal(latestRelease.html_url)
              break
            case 2: // DISABLE NOTIFICATION -> Stop searching for updates on startup
              settings.set('checkForNewVersionOnStartup', false)
              mainWindow.webContents.send('auto-updates-disabled')
            }
          }
          )
        }
      } catch (e) {
        console.error(`ERROR: [PARSE JSON] ${JSON.stringify(e)}`)
      }
    }).on('error', error => {
      console.error(`ERROR: [RESPONSE] ${JSON.stringify(error)}`)
    })
  }).on('error', error => {
    console.error(`ERROR: [REQUEST] ${JSON.stringify(error)}`)
  }).on('close', () => {
    // will be called after 'the last' event in the HTTP request-response transaction was done
    // because of that unblock the use of this function
    alreadyCheckingForUpdates = false
  }).end()
}

// interprocess communication listeners
ipcMain
  .on('get-settings', (event, arg) => {
    event.returnValue = settings.get(arg)
  })
  .on('get-settings-default', (event, arg) => {
    event.returnValue = settings.getDefault(arg)
  })
  .on('reset-settings', (event, arg) => {
    event.returnValue = settings.reset(arg)
  })
  .on('reset-settings-all', (event) => {
    settings.resetAll()
    event.returnValue = true
  })
  .on('set-settings', (event, arg) => {
    settings.set(arg.name, arg.value)
  })
  .on('get-name', event => {
    event.returnValue = app.getName()
  })
  .on('check-for-update', checkForNewVersion)
  .on('relaunch', () => {
    // save settings before closing the app
    saveSettings()
    // close and reopen the app
    app.relaunch({ args: process.argv.slice(1).concat(['--relaunch']) })
    app.exit(0)
  })

/**
 * Create the main window
 */
const createWindow = () => {
  // get settings
  const settingsWindowBounds = settings.get('windowBounds')
  const settingsNativeTitleBar = settings.get('nativeTitleBar')
  const settingsTray = settings.get('tray')
  // create a BrowserWindow object
  mainWindow = new BrowserWindow({
    center: settingsWindowBounds.x === 0 && settingsWindowBounds.y === 0,
    frame: settingsNativeTitleBar,
    height: settingsWindowBounds.height,
    icon: path.join(__dirname, 'icon', 'icon.png'),
    minHeight: 600,
    minWidth: 600,
    show: false, // do not show the window before content is loaded
    title: app.getName(),
    titleBarStyle: 'hidden', // macOS: buttons are an overlay
    webPreferences: {
      enableRemoteModule: true,
      nodeIntegration: true
    },
    width: settingsWindowBounds.width,
    x: settingsWindowBounds.x,
    y: settingsWindowBounds.y
  })
  // load the 'index.html' file in the window
  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, 'index.html'),
      protocol: 'file:',
      slashes: true
    })
  )
  // if a native title bar is wanted add a menu bar
  if (settingsNativeTitleBar) {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          click: () => {
            mainWindow.webContents.send('toggleSettings')
          },
          label: 'Settings'
        },
        {
          click: () => {
            mainWindow.webContents.send('toggleAbout')
          },
          label: 'About'
        }
      ])
    )
  }
  // if a tray icon is wanted create one
  if (settingsTray) {
    // create tray icon and right click method
    const tray = new Tray(path.join(__dirname, 'icon', 'icon.png')).on('click', () => {
      // if tray icon is clicked the window will either be hidden or shown
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
      }
    })
    // create left click method / context menu
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          click: () => {
            mainWindow.close()
          },
          label: 'Close'
        }
      ])
    )
    // create text that will be shown on hover of the tray icon
    tray.setToolTip('Click to hide or show the app')
  }
  // window event listener
  mainWindow
    .on('ready-to-show', () => {
      // if page is loaded show window
      mainWindow.show()
      // and focus the window
      mainWindow.focus()
      // and if settings say so check if a new version is available
      if (settings.get('checkForNewVersionOnStartup')) checkForNewVersion()
    })
    .on('minimize', () => {
      // if settings say so hide window from taskbar
      if (settingsTray) mainWindow.hide()
    })
    .on('close', saveSettings)
    .on('closed', () => {
      // dereference the window object
      mainWindow = null
    })
}

/**
 * Save current settings (+ window size/position) in preferences file
 */
const saveSettings = () => {
  settings.set('windowBounds', mainWindow.getBounds())
  settings.save()
}

// app listeners (ready = electron is loaded)
app
  .on('ready', createWindow)
  .on('window-all-closed', () => {
    // quit app if all windows are closed
    // macOS: Applications keep their menu bar until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') app.quit()
  }).on('activate', () => {
    // macOS: Re-create a window in the app when the dock icon is clicked and there are no other open windows
    if (mainWindow === null) createWindow()
  })
