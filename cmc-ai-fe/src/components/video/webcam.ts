/** Dùng chung 1 luồng webcam cho mọi ô camera có nguồn "webcam" */
let streamP: Promise<MediaStream> | null = null;

export function getWebcamStream(): Promise<MediaStream> {
  if (!streamP) {
    if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('no-gum'));
    streamP = navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false }).catch((e) => {
      streamP = null;
      throw e;
    });
  }
  return streamP;
}
