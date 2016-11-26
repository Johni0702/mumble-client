export function getOSName () {
  if (process.browser) {
    return 'Browser'
  } else {
    return 'Node.js'
  }
}

export function getOSVersion () {
  if (process.browser) {
    return navigator.userAgent
  } else {
    return process.version
  }
}

