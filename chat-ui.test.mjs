import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const copyScript = await readFile(new URL("./scripts/copy-web.mjs", import.meta.url), "utf8");
const nativePatch = await readFile(new URL("./scripts/patch-android-audio.mjs", import.meta.url), "utf8");

test("chat wallpaper survives the later immersive-chat stylesheet and is packaged locally", () => {
  const immersiveRule = html.match(/#chat \.messages\{height:[\s\S]*?scroll-behavior:smooth;overscroll-behavior:contain\}/)?.[0] || "";
  assert.ok(immersiveRule.includes('url("./assets/chat-wallpaper.jpg")'));
  assert.ok(immersiveRule.includes("background-position:center center"));
  assert.ok(immersiveRule.includes("background-size:contain"));
  assert.ok(!immersiveRule.includes("background-size:cover"));
  assert.ok(copyScript.includes('"assets/chat-wallpaper.jpg"'));
});

test("chat image attachment invokes the native Android camera and gallery chooser", () => {
  assert.ok(html.includes('id="chatImageInput" type="file" accept="image/*" class="hidden"'));
  assert.ok(html.includes("try{selection=await chooseChatImage()}"));
  assert.ok(html.includes("using the system file picker as fallback"));
  assert.ok(html.includes("byId('chatImageInput').click();return"));
  assert.ok(html.includes("byId('chatAttachButton').addEventListener('click',openChatImagePicker)"));
  assert.ok(!html.includes('capture="environment"'));
  assert.ok(!html.includes("chatPhotoSourceMenu"));
  assert.ok(nativePatch.includes('Intent.createChooser(contentIntent, "Seleccionar fotografía")'));
  assert.ok(nativePatch.includes("Intent.EXTRA_INITIAL_INTENTS"));
  assert.ok(nativePatch.includes("DantePhotoChooserPlugin.class"));
  assert.ok(nativePatch.includes("FileProvider.getUriForFile"));
});

test("voice gesture guide is inline with the microphone and supports full horizontal drag with animation", () => {
  const form = html.indexOf('<form class="chatcompose" id="chatForm">');
  const guide = html.indexOf('id="chatRecordingGestureBar"');
  const mic = html.indexOf('id="chatRecordButton"');
  assert.ok(form >= 0 && guide > form && mic > guide);
  assert.ok(html.includes("#chat .chat-recording-gesture-bar{position:absolute;left:12px;right:116px;top:50%"));
  assert.ok(html.includes("@keyframes chat-recording-bar-in"));
  assert.ok(html.includes("@keyframes chat-mic-recording-pulse"));
  assert.ok(html.includes("@keyframes chat-lock-confirm"));
  assert.ok(html.includes("const horizontalLimit=Math.min(260,window.innerWidth*.7);const dx=Math.max(-horizontalLimit,Math.min(horizontalLimit,event.clientX-chatRecordingPointerStart.x));"));
});

test("Android photo chooser always aligns FileProvider authority and path metadata with the actual app package", () => {
  assert.ok(nativePatch.includes('const expectedAuthority = packageName + ".dante.fileprovider"'));
  assert.ok(nativePatch.includes('android.support.FILE_PROVIDER_PATHS'));
  assert.ok(nativePatch.includes('@xml/dante_file_paths'));
  assert.ok(nativePatch.includes('call.reject("No se pudo abrir el selector de fotografías: "'));
});

test("chat messages render their sent time in 24-hour hour:minute format", () => {
  assert.ok(html.includes("function formatChatMessageTime(value)"));
  assert.ok(html.includes("toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false})"));
  assert.ok(html.includes("className='msg-time'"));
});

test("passenger profile image is centered and cropped inside the circular avatar", () => {
  assert.ok(html.includes("object-fit:cover;object-position:50% 50%"));
  assert.ok(html.includes("transform:none!important"));
});

test("fullscreen chat keeps the camera button aligned to its input shell", () => {
  assert.ok(html.includes("body.chat-screen-open #chat .chat-camera-button"));
  assert.ok(html.includes("position:absolute!important"));
  assert.ok(html.includes("transform:translateY(-50%)!important"));
});

test("voice recording visibly drags the microphone to a trash target and turns red before cancellation", () => {
  assert.ok(html.includes('id="chatRecordingTrashTarget"'));
  assert.ok(html.includes("overTrash=event.clientX"));
  assert.ok(html.includes("classList.toggle('is-cancelling',overTrash)"));
  assert.ok(html.includes("--chat-mic-drag-x"));
  assert.ok(html.includes("shouldCancel){cancelChatRecording()"));
});

test("voice recording locks hands-free with a visible lock and sends on release otherwise", () => {
  assert.ok(html.includes("dy<=-76"));
  assert.ok(html.includes('id="chatRecordingLockHint"'));
  assert.ok(html.includes("function showLockedChatRecordingControls()"));
  assert.ok(html.includes("chatRecordingGestureMode='locked'"));
  assert.ok(html.includes("function stopChatAudioRecording()"));
  assert.ok(!html.includes("elapsed<280"));
  assert.ok(html.includes("chatRecordingRequestPending=true"));
  assert.ok(html.includes("chatRecordingRequestPending&&!chatMediaRecorder"));
  assert.ok(html.includes("chatSendRecordingButton"));
});


test("chat uses one green header at the top of both list and fullscreen layouts", () => {
  const section = html.slice(html.indexOf('<section id="chat"'), html.indexOf('</section>', html.indexOf('<section id="chat"')));
  assert.ok(!section.includes('Mensajería'));
  assert.ok(section.indexOf('class="chathead"') < section.indexOf('class="chat-list-controls"'));
  assert.ok(section.includes('class="chathead-actions"'));
  assert.ok(section.includes('id="chatRefreshButton"'));
  assert.ok(section.includes('id="chatFullscreenButton"'));
  assert.ok(html.includes('padding: max(12px,env(safe-area-inset-top))'));
  assert.ok(html.includes('viewport-fit=cover'));
  assert.ok(html.includes('body.chat-screen-open #chat .chat-list-controls{display:none!important}'));
});

test("chat message text uses explicit sender and body elements without changing timestamp placement", () => {
  assert.ok(html.includes("sender.className='msg-sender'"));
  assert.ok(html.includes("body.className='msg-text';body.textContent=textValue"));
  assert.ok(html.includes("#chat .msg .msg-sender{display:block;font-size:11px"));
  assert.ok(html.includes("#chat .msg .msg-text{display:block;white-space:pre-wrap"));
  assert.ok(html.includes("#chat .msg-time{position:static;display:block;align-self:flex-end"));
});

test("message timestamps flow below content instead of overlaying audio or text", () => {
  assert.ok(html.includes("#chat .msg-time{position:static;display:block"));
  assert.ok(html.includes("const sentTime=item.querySelector('.msg-time');if(sentTime)item.appendChild(sentTime)"));
  assert.ok(html.includes("#chat .chat-audio-player{width:min(310px,100%)"));
});

test("hands-free recording controls use a separate wrapping row and do not collide with the gesture bar", () => {
  assert.ok(html.includes("#chat .chat-recording-gesture-bar.is-locked{position:relative;inset:auto"));
  assert.ok(html.includes("#chat .chatcompose:has(#chatSendRecordingButton:not(.hidden)){flex-wrap:wrap"));
  assert.ok(html.includes("#chat .chatcompose:has(#chatSendRecordingButton:not(.hidden)) #chatCancelRecordingButton"));
});

test("microphone drag transform remains enabled in fullscreen chat", () => {
  assert.ok(html.includes("body.chat-screen-open #chat .chat-mic-button.is-dragging{transform:translate3d(var(--chat-mic-drag-x,0px),var(--chat-mic-drag-y,0px),0) scale(1.08)!important"));
});


test("chat bubbles keep text, attachments and timestamps inside a flexible padded box", () => {
  assert.ok(html.includes("#chat .msg{box-sizing:border-box;display:flex;flex-direction:column;align-items:stretch;gap:3px;flex:0 0 auto;width:fit-content;min-width:0;max-width:min(88%,520px);padding:12px 14px"));
  assert.ok(html.includes("overflow-wrap:anywhere;word-break:break-word;line-break:anywhere;overflow:visible"));
  assert.ok(html.includes("overflow-wrap:anywhere;word-break:break-word"));
  assert.ok(html.includes("#chat .msg-time{position:static;display:block;align-self:flex-end"));
  assert.ok(html.includes("#chat .msg .chat-audio-player{width:min(310px,100%)"));
});

test("compact chat keeps the composer pinned, preserves complete bubbles and hides technical filler", () => {
  assert.ok(html.includes("#chat .chatcompose{position:fixed;left:50%;bottom:0;transform:translateX(-50%);z-index:10001;display:flex;flex:0 0 auto"));
  assert.ok(html.includes("padding-bottom:calc(90px + env(safe-area-inset-bottom))"));
  assert.ok(html.includes("body.chat-screen-open #chat .chatcompose{position:relative!important;left:auto!important;bottom:auto!important;transform:none!important;width:auto!important;z-index:2!important}"));
  assert.ok(!html.includes("id=\"chatIntro\""));
  assert.ok(!html.includes("Conversaciones de pasajeros, choferes, operadores y administración."));
  assert.ok(!html.includes("Refresco de respaldo cada 7 segundos"));
  assert.ok(!html.includes("se mantiene el refresco de respaldo cada 7 segundos"));
  assert.ok(html.includes("refreshChatConversations(true)},7000)"));
});

test("voice recording hides the text composer fluidly and shows a live elapsed counter", () => {
  assert.ok(html.includes('id="chatRecordingElapsed"'));
  assert.ok(html.includes("chatRecordingElapsed').textContent=duration"));
  assert.ok(html.includes("chatcompose.is-recording .chat-input-shell{flex:0 1 0"));
  assert.ok(html.includes("chatcompose.is-recording #chatSendButton{flex:0 1 0"));
  assert.ok(html.includes("return String(Math.floor(seconds/60))+':'+String(seconds%60).padStart(2,'0')"));
});

test("hands-free voice mode exposes pause, resume, cancel and send controls without overlaying the input", () => {
  assert.ok(html.includes('id="chatPauseRecordingButton"'));
  assert.ok(html.includes("function toggleChatRecordingPause()"));
  assert.ok(html.includes("recorder.pause()"));
  assert.ok(html.includes("recorder.resume()"));
  assert.ok(html.includes("chatMediaRecorder.state==='recording'||chatMediaRecorder.state==='paused'"));
  assert.ok(html.includes("chatMediaRecorder?.state==='recording'||chatMediaRecorder?.state==='paused'"));
  assert.ok(html.includes("chatcompose.is-recording.is-locked #chatPauseRecordingButton"));
  assert.ok(html.includes("chatcompose.is-recording.is-locked #chatCancelRecordingButton"));
  assert.ok(html.includes("chatcompose.is-recording.is-locked #chatSendRecordingButton"));
});
