"use client";

export function stopCameraStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

export function getCameraStreamConstraints(deviceId) {
  return {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "user" } }),
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
}

export async function listVideoInputDevices() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  let fallbackIndex = 0;

  return devices
    .filter((device) => device.kind === "videoinput")
    .map((device) => {
      fallbackIndex += 1;

      return {
        deviceId: device.deviceId,
        label: device.label?.trim() || `Câmera ${fallbackIndex}`,
      };
    });
}

export function resolvePreferredCameraId(currentCameraId, devices) {
  if (currentCameraId && devices.some((device) => device.deviceId === currentCameraId)) {
    return currentCameraId;
  }

  return "";
}
