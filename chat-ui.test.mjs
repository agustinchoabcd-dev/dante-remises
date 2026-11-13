import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");

test("chat photo picker offers Android camera and gallery separately", () => {
  assert.match(html, /id="chatCameraInput"[^>]*capture="environment"/);
  assert.match(html, /id="chatImageInput"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /id="chatTakePhotoButton"/);
  assert.match(html, /id="chatChoosePhotoButton"/);
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

test("voice recording supports hold-to-send, left-swipe cancellation and hands-free lock", () => {
  assert.match(html, /addEventListener\('pointerdown'/);
  assert.match(html, /dx<=-72/);
  assert.match(html, /dy<=-72/);
  assert.match(html, /elapsed<280/);
  assert.match(html, /chatRecordingGestureMode='locked'/);
  assert.match(html, /id="chatRecordingGestureBar"/);
  assert.match(html, /← Deslizá para cancelar/);
  assert.match(html, /↑ para manos libres/);
  assert.match(html, /chatRecordingRequestPending=true/);
  assert.match(html, /chatRecordingRequestPending&&!chatMediaRecorder/);
  assert.match(html, /chatSendRecordingButton'\)\.addEventListener\('click'/);
  assert.match(html, /chatMediaRecorder\?\.state==='recording'/);
});
