import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const copyScript = await readFile(new URL("./scripts/copy-web.mjs", import.meta.url), "utf8");

test("chat wallpaper survives the later immersive-chat stylesheet and is packaged locally", () => {
  const immersiveRule = html.match(/#chat \.messages\{height:[\s\S]*?scroll-behavior:smooth;overscroll-behavior:contain\}/)?.[0] || "";
  assert.match(immersiveRule, /background-image:[^;]*url\("\.\/assets\/chat-wallpaper\.jpg"\)/);
  assert.match(immersiveRule, /background-position:center center/);
  assert.match(immersiveRule, /background-size:cover/);
  assert.match(copyScript, /"assets\/chat-wallpaper\.jpg"/);
});

test("chat image attachment opens the Android system content picker without a custom source menu", () => {
  assert.match(html, /id="chatImageInput" type="file" accept="image\/\*" class="hidden"/);
  assert.match(html, /byId\('chatAttachButton'\)\.addEventListener\('click',\(\)=>byId\('chatImageInput'\)\.click\(\)\)/);
  assert.doesNotMatch(html, /capture="environment"/);
  assert.doesNotMatch(html, /chatPhotoSourceMenu|chatTakePhotoButton|chatChoosePhotoButton/);
  assert.match(html, /function handleChatImageSelection\(event\)/);
});

test("chat messages render their sent time in 24-hour hour:minute format", () => {
  assert.match(html, /function formatChatMessageTime\(value\)/);
  assert.match(html, /toLocaleTimeString\('es-AR',\{hour:'2-digit',minute:'2-digit',hour12:false\}\)/);
  assert.match(html, /className='msg-time'/);
});

test("passenger profile image is centered and cropped inside the circular avatar", () => {
  assert.match(html, /#chat \.chat-peer-avatar img\{[^}]*object-fit:cover;object-position:50% 50%/);
  assert.match(html, /#chat \.chat-peer-avatar img\{[^}]*transform:none!important/);
});

test("fullscreen chat keeps the camera button aligned to its input shell", () => {
  assert.match(html, /body\.chat-screen-open #chat \.chat-camera-button\{[^}]*position:absolute!important/);
  assert.match(html, /body\.chat-screen-open #chat \.chat-camera-button\{[^}]*transform:translateY\(-50%\)!important/);
});

test("voice recording visibly drags the microphone to a trash target and turns red before cancellation", () => {
  assert.match(html, /id="chatRecordingTrashTarget"/);
  assert.match(html, /id="chatRecordingGestureText"/);
  assert.match(html, /overTrash=event\.clientX/);
  assert.match(html, /classList\.toggle\('is-cancelling',overTrash\)/);
  assert.match(html, /--chat-mic-drag-x/);
  assert.match(html, /shouldCancel\)\{cancelChatRecording\(\)/);
});

test("voice recording locks hands-free with a visible lock and sends on release otherwise", () => {
  assert.match(html, /dy<=-76/);
  assert.match(html, /id="chatRecordingLockHint"/);
  assert.match(html, /function showLockedChatRecordingControls\(\)/);
  assert.match(html, /chatRecordingGestureMode='locked'/);
  assert.match(html, /function stopChatAudioRecording\(\)/);
  assert.doesNotMatch(html, /elapsed<280/);
  assert.match(html, /chatRecordingRequestPending=true/);
  assert.match(html, /chatRecordingRequestPending&&!chatMediaRecorder/);
  assert.match(html, /chatSendRecordingButton'\)\.addEventListener\('click'/);
});
