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
  assert.ok(immersiveRule.includes("background-size:cover"));
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
