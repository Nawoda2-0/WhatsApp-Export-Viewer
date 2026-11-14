/* WhatsApp TXT Chat Viewer — runs entirely in the browser; no uploads, trackers or external dependencies. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { chats: [], activeId: null, matches: [], matchIndex: -1, filter: 'all', searchTerm: '', infoTab:'media' };
  const mediaExt = /\.(?:jpe?g|png|gif|webp|bmp|avif|heic|mp4|m4v|mov|webm|3gp|mkv|mp3|wav|m4a|aac|ogg|opus|oga|amr|pdf|docx?|xlsx?|pptx?|txt|zip|7z|vcf)$/i;
  const imageExt = /\.(?:jpe?g|png|gif|webp|bmp|avif|heic)$/i;
  const videoExt = /\.(?:mp4|m4v|mov|webm|3gp|mkv)$/i;
  const audioExt = /\.(?:mp3|wav|m4a|aac|ogg|opus|oga|amr)$/i;
  const mediaKind = name => imageExt.test(name)? (/^(?:STK-|sticker)/i.test(name)?'sticker':'image') : videoExt.test(name)?'video':audioExt.test(name)?'audio':'document';
  const basename = path => String(path).replace(/\\/g,'/').split('/').pop();
  const normalizeFile = name => basename(name).normalize('NFC').trim().toLocaleLowerCase();
  const urlCache = new Map();
  function objectUrl(file){ if(!urlCache.has(file))urlCache.set(file,URL.createObjectURL(file));return urlCache.get(file); }
  function releaseMedia(){for(const url of urlCache.values())URL.revokeObjectURL(url);urlCache.clear();}
  const elements = {
    app: $('app'), sidebar: $('sidebar'), list: $('chatList'), file: $('fileInput'),
    conversation: $('conversation'), welcome: $('welcomeScreen'), messages: $('messages'), scroller: $('messagesScroller')
  };
  const htmlEscape = str => String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeDate = (d,m,y,h=0,minute=0,s=0) => {
    const year=Number(y)<100?Number(y)+(Number(y)>=70?1900:2000):Number(y);
    const date=new Date(year,Number(m)-1,Number(d),Number(h),Number(minute),Number(s));
    return date.getFullYear()===year && date.getMonth()===Number(m)-1 && date.getDate()===Number(d) ? date : null;
  };
  function parseDate(raw, format) {
    // Accepts 2024-01-30, 30/01/2024, 01/30/2024, 30.01.24, 30-01-24, etc.
    const a = raw.trim().match(/^(\d{1,4})[\/\.\-](\d{1,2})[\/\.\-](\d{1,4})$/);
    if (!a) return null;
    const x=Number(a[1]), y=Number(a[2]), z=Number(a[3]);
    if (String(a[1]).length===4) return safeDate(z,y,x);
    if (x>12) return safeDate(x,y,z);
    if (y>12) return safeDate(y,x,z);
    return format==='MDY' ? safeDate(y,x,z) : safeDate(x,y,z);
  }
  function parseClock(raw) {
    const cleaned=raw.replace(/[\u200e\u200f\u202a-\u202e]/g,'').replace(/\./g,'').trim();
    const match=cleaned.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/);
    if(!match) return null;
    let hour=Number(match[1]); const minute=Number(match[2]), sec=Number(match[3]||0);
    if(minute>59||sec>59||hour>23) return null;
    if(match[4]) { if(hour<1||hour>12)return null; hour=hour%12+(match[4].toUpperCase()==='PM'?12:0); }
    return [hour,minute,sec];
  }
  function detectFormat(text) {
    // Prefer day/month unless clear evidence of month/day; preserves familiar international export format.
    let dmy=0,mdy=0;
    for(const line of text.split('\n').slice(0,1200)) {
      const m=line.match(/^\s*(?:\[)?(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/);
      if(!m)continue;
      if(Number(m[1])>12)dmy++;
      if(Number(m[2])>12)mdy++;
    }
    return mdy>dmy?'MDY':'DMY';
  }
  function parseChat(text, fileName) {
    text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/[\u200e\u200f\u202a-\u202e]/g,'');
    const format=detectFormat(text);
    const messages=[];
    // Android: 14/11/2026, 10:23 - Sender: message
    // iOS: [14/11/2026, 10:23:12] Sender: message
    // Alternate Android: 14/11/2026, 10:23:12: Sender: message
    const start=/^\s*(?:\[([^\]]+?)\]\s*|((?:\d{1,4}[\/\.\-]){2}\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?)\s*(?:-|–|—|:)\s*)(.*)$/;
    let current=null;
    for (const rawLine of text.split('\n')) {
      const match=rawLine.match(start);
      let parsed=null;
      if(match) {
        let datePart,timePart,body;
        if(match[1]) {
          const inside=match[1].match(/^(.+?)[,\s]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?)$/);
          if(inside){datePart=inside[1];timePart=inside[2];body=match[4];}
        } else {datePart=match[2];timePart=match[3];body=match[4];}
        if(datePart&&timePart){
          const date=parseDate(datePart,format),clock=parseClock(timePart);
          if(date&&clock){date.setHours(...clock);parsed={date,time:date.getTime(),body};}
        }
      }
      if(parsed) {
        // Names can contain colons, but the first ": " reliably separates the sender field.
        const idx=parsed.body.indexOf(': ');
        const sender=idx>0 && idx<110 ? parsed.body.slice(0,idx).trim() : null;
        const content=sender?parsed.body.slice(idx+2):parsed.body;
        current={id:messages.length,date:parsed.date,time:parsed.time,sender,text:content,system:!sender};
        messages.push(current);
      } else if(current) current.text+='\n'+rawLine;
    }
    if(!messages.length)throw new Error('No WhatsApp messages were found. Check that this is an exported WhatsApp .txt file.');
    const senders=[...new Set(messages.map(m=>m.sender).filter(Boolean))];
    const names=senders.reduce((map,name)=>{map[name]=messages.filter(m=>m.sender===name).length;return map;},{});
    // Best effort only. Users can override this in settings.
    const likelyMe=senders.find(n=>/^(me|you)$/i.test(n)) || ''; // Never guess based on participant order
    const base=fileName.replace(/\.txt$/i,'').replace(/^WhatsApp Chat (?:with )?/i,'').replace(/^Chat with /i,'').replace(/^_chat$/i,'Chat').trim();
    const title=base==='Chat'||!base ? (senders.length===2 ? senders.find(s=>s!==likelyMe)||'Imported chat' : 'Imported group') : base;
    return {id:crypto.randomUUID?.()||String(Date.now()+Math.random()),title,fileName,messages,senders,names,likelyMe,me:likelyMe,isGroup:senders.length>2,first:messages[0].date,last:messages[messages.length-1].date};
  }
  // Exact filename matching prevents the wrong image from appearing under a message.
  // A message can include captions or multiline text after the attachment notice.
  function attachmentName(text){
    const m=String(text).match(/(?:^|\n)\s*(?:\u200e)?([^\n\r<>]{1,260}\.[a-z0-9]{2,5})\s*\(file attached\)/i);
    return m ? basename(m[1].trim()) : null;
  }
  function attachMedia(chat, files){
    const lookup=new Map();
    for(const file of files){const key=normalizeFile(file.name);if(mediaExt.test(key)&&!lookup.has(key))lookup.set(key,file);}
    chat.media=[];
    chat.links=[];
    for(const msg of chat.messages){
      msg.media=null;
      if(msg.system)continue;
      const name=attachmentName(msg.text);
      if(name){
        const file=lookup.get(normalizeFile(name));
        if(file){msg.media={name,file,kind:mediaKind(name),msgId:msg.id};chat.media.push(msg.media);}
      }
      for(const m of msg.text.matchAll(/https?:\/\/[^\s<>"']+/g)){
        const candidate=m[0].replace(/[.,;!?)]*$/,'');
        try{const url=new URL(candidate);if(['http:','https:'].includes(url.protocol))chat.links.push({url:candidate,date:msg.date,msgId:msg.id});}catch{}
      }
    }
    chat.matched=chat.media.length;
  }
  function usableSrc(media){return htmlEscape(objectUrl(media.file));}
  function mediaMarkup(media,full=false){
    const src=usableSrc(media);
    const id=media.msgId;
    if(media.kind==='image'||media.kind==='sticker')return `<button type="button" class="attachment-image ${media.kind==='sticker'?'sticker-image':''}" data-media-id="${id}" title="Open ${htmlEscape(media.name)}"><img src="${src}" alt="${htmlEscape(media.name)}" loading="lazy"></button>`;
    if(media.kind==='video')return `<button type="button" class="attachment-video" data-media-id="${id}" title="Play video"><video src="${src}#t=0.1" preload="metadata" muted playsinline></video><span class="play-circle">▶</span></button>`;
    if(media.kind==='audio')return `<div class="attachment-audio"><span class="audio-symbol">♫</span><audio controls preload="none" src="${src}"></audio></div>`;
    return `<button type="button" class="attachment-document" data-media-id="${id}"><span class="doc-icon">▤</span><span>${htmlEscape(media.name)}</span><span class="doc-arrow">↗</span></button>`;
  }
  function messageContent(msg){
    if(!msg.media){return isMedia(msg.text)?`<span class="media-placeholder">▧ ${htmlEscape(msg.text)}</span>`:safeLinks(msg.text);}
    const remaining=msg.text.replace(/(?:^|\n)\s*(?:\u200e)?[^\n\r<>]{1,260}\.[a-z0-9]{2,5}\s*\(file attached\)\s*/i,'').trim();
    return mediaMarkup(msg.media)+(remaining?`<div class="media-caption">${safeLinks(remaining)}</div>`:'');
  }
  function openMediaById(id){
    const chat=currentChat(),msg=chat?.messages.find(m=>m.id===Number(id));
    if(!msg?.media)return;
    const media=msg.media,src=objectUrl(media.file);
    $('mediaTitle').textContent=media.name;
    $('mediaDownload').href=src;$('mediaDownload').download=media.name;
    const viewer=$('mediaViewer');viewer.replaceChildren();
    let node;
    if(['image','sticker'].includes(media.kind)){node=document.createElement('img');node.alt=media.name;}
    else if(media.kind==='video'){node=document.createElement('video');node.controls=true;node.autoplay=true;node.playsInline=true;}
    else if(media.kind==='audio'){node=document.createElement('audio');node.controls=true;node.autoplay=true;}
    else if(media.name.toLowerCase().endsWith('.pdf')){node=document.createElement('iframe');node.title=media.name;}
    else {node=document.createElement('p');node.textContent='Preview unavailable. Use Download to open this document.';}
    if(node.tagName!=='P')node.src=src;
    viewer.append(node);$('mediaDialog').showModal();
  }
  function closeMedia(){const d=$('mediaDialog');d.close();$('mediaViewer').replaceChildren();}
  function buildInfoContent(chat){
    const counts=chat.media.reduce((m,item)=>(m[item.kind]=(m[item.kind]||0)+1,m),{});
    const tab=state.infoTab;
    let content='';
    if(tab==='media'){
      content=chat.media.filter(m=>m.kind!=='document').map(m=>`<button type="button" class="gallery-tile" data-media-id="${m.msgId}" title="${htmlEscape(m.name)}">${['image','sticker'].includes(m.kind)?`<img src="${usableSrc(m)}" loading="lazy" alt="${htmlEscape(m.name)}">`:m.kind==='video'?`<video src="${usableSrc(m)}#t=0.1" muted preload="metadata"></video><span class="gallery-play">▶</span>`:'<span class="gallery-audio">♫</span>'}</button>`).join('')||'<p class="tab-empty">No matching photos, stickers, videos, or audio were found in this export.</p>';
      content=`<div class="media-grid">${content}</div>`;
    }else if(tab==='links'){
      content=chat.links.map(l=>`<a class="info-link" href="${htmlEscape(l.url)}" target="_blank" rel="noopener noreferrer"><span>🔗</span><span>${htmlEscape(l.url)}</span></a>`).join('')||'<p class="tab-empty">No links found in the chat.</p>';
    }else{
      content=chat.media.filter(m=>m.kind==='document').map(m=>`<button type="button" class="info-doc" data-media-id="${m.msgId}"><span>▤</span><span>${htmlEscape(m.name)}</span><span>↗</span></button>`).join('')||'<p class="tab-empty">No matching document files were found.</p>';
    }
    const total=chat.media.length;
    $('chatInfo').innerHTML=`<div class="profile-hero"><div class="profile-avatar" style="background:${avatarColor(chat.title)}">${htmlEscape(chat.title.charAt(0).toUpperCase())}</div><h3>${htmlEscape(chat.title)}</h3><p>${chat.isGroup?`${chat.senders.length} participants`:'Imported WhatsApp conversation'}</p><p>${chat.messages.length.toLocaleString()} messages · ${total} matched attachments</p></div><div class="profile-stat">${(counts.image||0)+(counts.sticker||0)} images & stickers · ${counts.video||0} videos · ${counts.audio||0} audio · ${counts.document||0} docs</div><div class="info-tabs"><button type="button" data-tab="media" class="${tab==='media'?'selected':''}">Media</button><button type="button" data-tab="links" class="${tab==='links'?'selected':''}">Links (${chat.links.length})</button><button type="button" data-tab="docs" class="${tab==='docs'?'selected':''}">Docs</button></div><div class="info-tab-content">${content}</div><div class="profile-meta"><div>Export: ${htmlEscape(chat.fileName)}</div><div>From ${htmlEscape(formatDate(chat.first))} to ${htmlEscape(formatDate(chat.last))}</div><div>You: ${htmlEscape(myName(chat)||'Not selected')}</div></div>`;
  }
  const formatTime = date => new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(date);
  const formatDate = date => new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric'}).format(date);
  const dayKey = d => [d.getFullYear(),d.getMonth(),d.getDate()].join('-');
  const avatarColor = str => ['#7c8cc4','#62a49a','#ad8d65','#b27b9f','#7a9a72'][[...str].reduce((n,c)=>n+c.charCodeAt(0),0)%5];
  function avatarMarkup(title, isGroup){return `<span class="avatar${isGroup?' group':''}" style="background:${avatarColor(title)}">${htmlEscape(title.charAt(0).toUpperCase()||'C')}</span>`;}
  function currentChat(){return state.chats.find(c=>c.id===state.activeId);}
  function myName(chat){return chat.me||'';}
  function notify(message){const t=$('toast');t.textContent=message;t.classList.remove('hidden');clearTimeout(notify.timer);notify.timer=setTimeout(()=>t.classList.add('hidden'),4500);}
  function renderList(){
    const q=$('chatFilter').value.trim().toLocaleLowerCase();
    const filtered=state.chats.filter(c=>(!q || c.title.toLocaleLowerCase().includes(q)||c.senders.some(s=>s.toLocaleLowerCase().includes(q))) && (state.filter!=='groups'||c.isGroup) && state.filter!=='unread');
    if(!filtered.length){elements.list.innerHTML=`<div class="sidebar-empty">${state.chats.length?'No matching chats.':'Your imported conversations will appear here.'}</div>`;return;}
    elements.list.innerHTML=filtered.map(c=>{
      const last=c.messages[c.messages.length-1];return `<button type="button" class="chat-item ${state.activeId===c.id?'active':''}" data-id="${htmlEscape(c.id)}">${avatarMarkup(c.title,c.isGroup)}<span class="chat-content"><span class="chat-top"><strong>${htmlEscape(c.title)}</strong><span class="chat-time">${htmlEscape(formatDate(c.last))}</span></span><span class="chat-bottom"><span class="chat-preview">${htmlEscape((last.sender?last.sender+': ':'')+last.text.replace(/\s+/g,' ').slice(0,110))}</span></span></span></button>`;
    }).join('');
    elements.list.querySelectorAll('.chat-item').forEach(el=>el.addEventListener('click',()=>openChat(el.dataset.id)));
  }
  function isMedia(text){return /^\s*(?:<media omitted>|[\w\-. ()]+\.(?:jpg|jpeg|png|gif|webp|mp4|mov|mp3|ogg|opus|pdf|docx?|xlsx?|pptx?)\s*\(file attached\)|image omitted|video omitted|audio omitted|sticker omitted)\s*$/i.test(text.trim());}
  function safeLinks(raw){
    return String(raw).split(/(https?:\/\/[^\s<>"']+)/g).map(part=>{
      if(!/^https?:\/\//i.test(part))return htmlEscape(part);
      const trimmed=part.replace(/[.,;!?)]*$/,'');
      const trailing=part.slice(trimmed.length);
      try{const url=new URL(trimmed);if(!['http:','https:'].includes(url.protocol))return htmlEscape(part);return `<a href="${htmlEscape(trimmed)}" target="_blank" rel="noopener noreferrer">${htmlEscape(trimmed)}</a>${htmlEscape(trailing)}`;}catch{return htmlEscape(part);}
    }).join('');
  }
  function renderMessage(msg,chat,prev){
    if(msg.system)return `<div class="system-message">${htmlEscape(msg.text)}</div>`;
    const outgoing=msg.sender===myName(chat);
    const first=!prev||prev.sender!==msg.sender||prev.system||dayKey(prev.date)!==dayKey(msg.date);
    const sender=chat.isGroup&&!outgoing?`<div class="sender-name" style="color:${avatarColor(msg.sender)}">${htmlEscape(msg.sender)}</div>`:'';
    const media=messageContent(msg);
    const checks=outgoing?'<svg viewBox="0 0 22 14"><path d="m1 7 4 4 7-9m-3 9 4 0 8-9"/></svg>':'';
    return `<div class="message-row ${outgoing?'outgoing':'incoming'} ${first?'first':''}" id="msg-${msg.id}" data-id="${msg.id}"><div class="bubble">${sender}<div class="message-body">${media}</div><span class="message-meta">${htmlEscape(formatTime(msg.date))}${checks}</span></div></div>`;
  }
  function openChat(id){
    const chat=state.chats.find(c=>c.id===id);if(!chat)return;
    state.activeId=id;elements.app.classList.add('chat-open');elements.welcome.classList.add('hidden');elements.conversation.classList.remove('hidden');
    $('contactName').textContent=chat.title;
    $('activeAvatar').textContent=chat.title.charAt(0).toUpperCase();$('activeAvatar').style.background=avatarColor(chat.title);
    $('contactSubtitle').textContent=chat.isGroup?chat.senders.join(', '):`${chat.messages.length.toLocaleString()} messages · ${chat.matched||0} attachments`;
    let out='',lastDay='',prev=null;
    for(const msg of chat.messages){const day=dayKey(msg.date);if(day!==lastDay){out+=`<div class="date-chip">${htmlEscape(formatDate(msg.date))}</div>`;lastDay=day;}out+=renderMessage(msg,chat,prev);prev=msg;}
    elements.messages.innerHTML=out;
    $('inChatSearch').classList.add('hidden');$('messageSearch').value='';state.matches=[];state.matchIndex=-1;
    renderList();requestAnimationFrame(()=>{elements.scroller.scrollTop=elements.scroller.scrollHeight;});
  }
  async function importFiles(files){
    const all=[...files];
    const choices=all.filter(f=>f.name.toLowerCase().endsWith('.txt'));
    if(!choices.length){notify('No .txt export found. Select the folder with the exported chat and attachments.');return;}
    const media=all.filter(f=>mediaExt.test(f.name)&&!f.name.toLowerCase().endsWith('.txt'));
    let success=0,matched=0;
    for(const file of choices){
      try{
        if(file.size>60*1024*1024)throw new Error('Text file is over 60 MB.');
        const chat=parseChat(await file.text(),file.name);
        // When multiple export folders are selected, match media only within that export folder.
        const dir=(file.webkitRelativePath||'').split('/').slice(0,-1).join('/');
        const related=dir?media.filter(m=>(m.webkitRelativePath||'').startsWith(dir+'/')):media;
        attachMedia(chat,related);
        state.chats.unshift(chat);success++;matched+=chat.matched;
        openChat(chat.id);
      }catch(e){notify(`${file.name}: ${e.message}`);}
    }
    if(success){openSettings();notify(`Imported ${success} chat${success===1?'':'s'} with ${matched} linked media files. Choose your sender name.`);}
    elements.file.value='';$('folderInput').value='';
  }
  function refreshSearch(){
    const term=$('messageSearch').value.trim().toLocaleLowerCase();
    elements.messages.querySelectorAll('.search-current').forEach(e=>e.classList.remove('search-current'));
    state.matches=[];state.matchIndex=-1;
    const chat=currentChat();if(!chat||!term){$('searchCount').textContent='';return;}
    state.matches=chat.messages.filter(m=>m.text.toLocaleLowerCase().includes(term)).map(m=>m.id);
    state.matchIndex=state.matches.length?0:-1;
    jumpSearch();
  }
  function jumpSearch(){
    if(state.matchIndex<0){$('searchCount').textContent='0 results';return;}
    $('searchCount').textContent=`${state.matchIndex+1} of ${state.matches.length}`;
    elements.messages.querySelectorAll('.search-current').forEach(e=>e.classList.remove('search-current'));
    const row=$(`msg-${state.matches[state.matchIndex]}`);
    if(row){row.classList.add('search-current');row.scrollIntoView({behavior:'smooth',block:'center'});}
  }
  function closeDialogs(){document.querySelectorAll('dialog[open]').forEach(d=>d.close());}
  function openSettings(){
    closeDialogs();
    const chat=currentChat();
    const select=$('selfName');
    select.innerHTML='<option value="">-- Select your name --</option>';
    if(chat){for(const name of chat.senders){const opt=document.createElement('option');opt.value=name;opt.textContent=`${name} (${chat.names[name]} messages)`;select.append(opt);}select.value=myName(chat);}
    $('settingsDialog').showModal();
  }
  function openInfo(){const chat=currentChat();if(!chat)return;state.infoTab='media';buildInfoContent(chat);$('infoDialog').showModal();}
  $('openFileSidebar').addEventListener('click',()=>elements.file.click());$('importWelcome').addEventListener('click',()=>elements.file.click());
  $('openFolderSidebar').addEventListener('click',()=>$('folderInput').click());$('importFolderWelcome').addEventListener('click',()=>$('folderInput').click());
  $('folderInput').addEventListener('change',e=>importFiles(e.target.files));
  $('profileTrigger').addEventListener('click',openInfo);
  elements.file.addEventListener('change',e=>importFiles(e.target.files));
  $('themeToggle').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';$('themeToggle').title=dark?'Switch to dark mode':'Switch to light mode';});
  $('menuButton').addEventListener('click',openSettings);
  $('saveSettings').addEventListener('click',()=>{const chat=currentChat();if(!chat)return;if(!$('selfName').value){notify('Please select which sender is you.');return;}chat.me=$('selfName').value;closeDialogs();openChat(state.activeId);notify('Your green messages are now on the right.');});
  $('clearChats').addEventListener('click',()=>{if(!confirm('Remove all imported conversations from this viewer? This does not delete the original TXT files.'))return;closeMediaIfOpen();releaseMedia();state.chats=[];state.activeId=null;elements.app.classList.remove('chat-open');elements.conversation.classList.add('hidden');elements.welcome.classList.remove('hidden');closeDialogs();renderList();notify('Imported chats cleared.');});
  $('chatFilter').addEventListener('input',renderList);
  for(const [id,filter] of [['unreadChip','unread'],['groupsChip','groups']])$(id).addEventListener('click',()=>{state.filter=state.filter===filter?'all':filter;document.querySelectorAll('.filter-chip').forEach(el=>el.classList.toggle('active',el.textContent.trim().toLowerCase()===state.filter));renderList();});
  document.querySelector('.filter-chip').addEventListener('click',()=>{state.filter='all';document.querySelectorAll('.filter-chip').forEach(el=>el.classList.toggle('active',el.textContent.trim()==='All'));renderList();});
  $('backButton').addEventListener('click',()=>elements.app.classList.remove('chat-open'));
  $('searchToggle').addEventListener('click',()=>{$('inChatSearch').classList.toggle('hidden');if(!$('inChatSearch').classList.contains('hidden'))$('messageSearch').focus();});
  $('messageSearch').addEventListener('input',refreshSearch);
  $('searchNext').addEventListener('click',()=>{if(state.matches.length){state.matchIndex=(state.matchIndex+1)%state.matches.length;jumpSearch();}});
  $('searchPrev').addEventListener('click',()=>{if(state.matches.length){state.matchIndex=(state.matchIndex-1+state.matches.length)%state.matches.length;jumpSearch();}});
  $('searchClose').addEventListener('click',()=>{$('inChatSearch').classList.add('hidden');$('messageSearch').value='';state.matches=[];state.matchIndex=-1;elements.messages.querySelectorAll('.search-current').forEach(e=>e.classList.remove('search-current'));});
  $('jumpToBottom').addEventListener('click',()=>elements.scroller.scrollTo({top:elements.scroller.scrollHeight,behavior:'smooth'}));
  function closeMediaIfOpen(){if($('mediaDialog').open)closeMedia();}
  $('messages').addEventListener('click',e=>{const t=e.target.closest('[data-media-id]');if(t)openMediaById(t.dataset.mediaId);});
  $('chatInfo').addEventListener('click',e=>{const tab=e.target.closest('[data-tab]');if(tab){state.infoTab=tab.dataset.tab;buildInfoContent(currentChat());return;}const media=e.target.closest('[data-media-id]');if(media){$('infoDialog').close();openMediaById(media.dataset.mediaId);}});
  $('mediaClose').addEventListener('click',closeMedia);$('mediaDialog').addEventListener('close',()=>$('mediaViewer').replaceChildren());
  $('infoToggle').addEventListener('click',openInfo);$('setSenderButton').addEventListener('click',openSettings);
  document.querySelectorAll('.close-dialog,.close-info').forEach(b=>b.addEventListener('click',closeDialogs));
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));
  let dragDepth=0;
  document.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;$('dropOverlay').classList.remove('hidden');});
  document.addEventListener('dragover',e=>e.preventDefault());
  document.addEventListener('dragleave',e=>{e.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('dropOverlay').classList.add('hidden');});
  document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('dropOverlay').classList.add('hidden');if(e.dataTransfer?.files?.length)importFiles(e.dataTransfer.files);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('inChatSearch').classList.contains('hidden'))$('searchClose').click();if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'&&currentChat()){e.preventDefault();$('inChatSearch').classList.remove('hidden');$('messageSearch').focus();}});
  renderList();
})();
