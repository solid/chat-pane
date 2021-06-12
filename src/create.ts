import { authn, store, ns, widgets } from 'solid-ui'
import { NamedNode, st } from 'rdflib'
import longChatPane, { CHAT_LOCATION_IN_CONTAINER } from './longChatPane'

async function getMe () {
  const me = authn.currentUser()
  if (me === null) {
    throw new Error('Current user not found! Not logged in?')
  }
  await store.fetcher.load(me.doc())
  return me
}

async function getPodRoot (me): Promise<NamedNode> {
  const podRoot = store.any(me, ns.space('storage'), undefined, me.doc())
  if (!podRoot) {
    throw new Error('Current user pod root not found!')
  }
  return podRoot
}

async function sendInvite (invitee: NamedNode, chatThing: NamedNode) {
  await store.fetcher.load(invitee.doc())
  const inviteeInbox = store.any(invitee, ns.ldp('inbox'), undefined, invitee.doc())
  if (!inviteeInbox) {
    throw new Error(`Invitee inbox not found! ${invitee.value}`)
  }
  const inviteBody = `
<> a <http://www.w3.org/ns/pim/meeting#LongChatInvite> ;
${ns.rdf('seeAlso')} <${chatThing.value}> . 
  `
  
  const inviteResponse = await store.fetcher.webOperation('POST', inviteeInbox.value, {
    data: inviteBody,
    contentType: 'text/turtle'
  })
  const locationStr = inviteResponse.headers.get('location')
  if (!locationStr) {
    throw new Error(`Invite sending returned a ${inviteResponse.status}`)
  }
}

function determineChatContainer (invitee, podRoot) {
  // Create chat
  // See https://gitter.im/solid/chat-app?at=5f3c800f855be416a23ae74a
  const chatContainerStr = new URL(`IndividualChats/${new URL(invitee.value).hostname}/`, podRoot.value).toString()
  return new NamedNode(chatContainerStr)
}

async function createChatThing (chatContainer, me) {
  const created = await longChatPane.mintNew({
    session: {
      store
    }
  },
  {
    me,
    newBase: chatContainer.value
  })
  return created.newInstance
}

async function setAcl(chatContainer, me, invitee) {
  // Some servers don't present a Link http response header
  // if the container doesn't exist yet, so refetch the container
  // now that it has been created:
  await store.fetcher.load(chatContainer)

  // FIXME: check the Why value on this quad:
  const chatAclDoc = store.any(chatContainer, new NamedNode('http://www.iana.org/assignments/link-relations/acl'))
  if (!chatAclDoc) {
    throw new Error('Chat ACL doc not found!')
  }

  const aclBody = `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner>
    a acl:Authorization;
    acl:agent <${me.value}>;
    acl:accessTo <.>;
    acl:default <.>;
    acl:mode
        acl:Read, acl:Write, acl:Control.
<#invitee>
    a acl:Authorization;
    acl:agent <${invitee.value}>;
    acl:accessTo <.>;
    acl:default <.>;
    acl:mode
        acl:Read, acl:Append.
`
  const aclResponse = await store.fetcher.webOperation('PUT', chatAclDoc.value, {
    data: aclBody,
    contentType: 'text/turtle'
  })
}
async function addToPrivateTypeIndex(chatThing, me) {
  // Add to private type index
  const privateTypeIndex = store.any(me, ns.solid('privateTypeIndex')) as NamedNode | null
  if (!privateTypeIndex) {
    throw new Error('Private type index not found!')
  }
  await store.fetcher.load(privateTypeIndex)
  const reg = widgets.newThing(privateTypeIndex)
  const ins = [
    st(reg, ns.rdf('type'), ns.solid('TypeRegistration'), privateTypeIndex.doc()),
    st(reg, ns.solid('forClass'), ns.meeting('LongChat'), privateTypeIndex.doc()),
    st(reg, ns.solid('instance'), chatThing, privateTypeIndex.doc())
  ]
  await new Promise((resolve, reject) => {
    store.updater.update([], ins, function (_uri, ok, errm) {
      if (!ok) {
        reject(new Error(errm))
      } else {
        resolve()
      }
    })
  })
}

export async function findChat (invitee: NamedNode) {
  const me = await getMe()
  const podRoot = await getPodRoot(me)
  const chatContainer = determineChatContainer(invitee, podRoot)
  let exists = true
  try {
    await store.fetcher.load(new NamedNode(chatContainer.value + CHAT_LOCATION_IN_CONTAINER))
  } catch (e) {
    exists = false
  }
  return { me, chatContainer, exists}
}

export async function getChat (invitee: NamedNode, createIfMissing = true): Promise<NamedNode> {
  const { me, chatContainer, exists } = await findChat (invitee)
  if (exists) {
    return new NamedNode(chatContainer.value + CHAT_LOCATION_IN_CONTAINER)
  }

  if (createIfMissing) {
    const chatThing = await createChatThing(chatContainer, me)
    await sendInvite(invitee, chatThing)
    await setAcl(chatContainer, me, invitee)
    await addToPrivateTypeIndex(chatThing, me)
    return chatThing
  }
}
