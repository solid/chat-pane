/* global SolidAuthClient */

const ChatPane = require('./longChatPane.js')
const $rdf = require('rdflib')
const UI = require('solid-ui')
const SolidAuth = require('solid-auth-client')
const { getChat } = require('./create.ts')

const menuDiv = document.createElement('div')

async function renderMenuDiv () {
  console.log('get invites list')
  menuDiv.innerHTML = await getInvitesList()
  console.log('get chats list')
  menuDiv.innerHTML += await getChatsList()
}
// FIXME:
window.$rdf = $rdf
window.followLink = async function (from, follow, multiple) {
  const subject = $rdf.sym(from)
  const doc = subject.doc()
  await new Promise((resolve, reject) => {
    UI.store.fetcher.load(doc).then(resolve, reject)
  })
  const predicate = $rdf.sym(follow)
  if (multiple) {
    return UI.store.each(subject, predicate).map(n => n.value)
  }
  return UI.store.any(subject, predicate).value
}

function toLi (uri) {
  return `<li><a href="?#${encodeURIComponent(uri)}">${uri}</a></li>`
}

async function getChatsList () {
  const { instances } = await UI.authn.findAppInstances({}, $rdf.sym('http://www.w3.org/ns/pim/meeting#LongChat'))
  return `<h2>Your chats:
<ul>
  ${instances.map(n => n.value).map(toLi)}
</ul>`
}

window.inviteSomeone = async function () {
  const invitee = UI.store.namedNode(document.getElementById('invitee').value)
  const created = await getChat(invitee)
  console.log(created)
  renderMenuDiv()
}

async function getInvitesList () {
  const webId = (await SolidAuthClient.currentSession()).webId
  const globalInbox = await window.followLink(webId, UI.ns.ldp('inbox'))
  const inboxItems = await window.followLink(globalInbox, UI.ns.ldp('contains'), true)
  const invites = []
  const promises = inboxItems.map(async x => {
    try {
      const inboxMsgTypes = await window.followLink(x, UI.ns.rdf('type'), true)
      const isLongChatInvite = (inboxMsgTypes.indexOf('http://www.w3.org/ns/pim/meeting#LongChatInvite') !== -1)
      if (isLongChatInvite) {
        console.log('new chat!', x)
        const chatUrl = await window.followLink(x, UI.ns.rdf('seeAlso'))
        invites.push(chatUrl)
      }
    } catch (e) {
      console.error('Failed to parse inbox item', x)
    }
  })
  await Promise.all(promises)
  return `<h2>Your Invites:
  <ul>
    ${invites.map(toLi)}
  </ul>
  Invite someone: <input id="invitee"><button onclick="inviteSomeone()">Send Invite</button>`
}

async function appendChatPane (dom, uri) {
  const subject = $rdf.sym(uri)
  const doc = subject.doc()

  await new Promise((resolve, reject) => {
    UI.store.fetcher.load(doc).then(resolve, reject)
  })
  const context = { // see https://github.com/solid/solid-panes/blob/005f90295d83e499fd626bd84aeb3df10135d5c1/src/index.ts#L30-L34
    dom,
    session: {
      store: UI.store
    }
  }
  const options = {}
  renderMenuDiv()
  dom.body.appendChild(menuDiv)
  console.log('chat', subject)
  const paneDiv = ChatPane.render(subject, context, options)
  dom.body.appendChild(paneDiv)
}

document.addEventListener('DOMContentLoaded', function () {
})

window.onload = () => {
  console.log('document ready')
  SolidAuth.trackSession(async session => {
    if (!session) {
      console.log('The user is not logged in')
      document.getElementById('loginBanner').innerHTML = '<button onclick="popupLogin()">Log in</button>'
    } else {
      console.log(`Logged in as ${session.webId}`)

      document.getElementById('loginBanner').innerHTML = `Logged in as ${session.webId} <button onclick="logout()">Log out</button>`
      // Set up the view for the subject indicated in the fragment of the window's URL
      const uri = decodeURIComponent(window.location.hash.substr(1))
      if (uri.length === 0) {
        window.location = '?#' + encodeURIComponent('https://solidos.solidcommunity.net/Team/SolidOs%20team%20chat/index.ttl#this')
      }
      appendChatPane(document, uri)
    }
  })
}
window.logout = () => {
  SolidAuth.logout()
  window.location = ''
}
window.popupLogin = async function () {
  let session = await SolidAuth.currentSession()
  const popupUri = 'https://solidcommunity.net/common/popup.html'
  if (!session) {
    session = await SolidAuth.popupLogin({ popupUri })
  }
}
