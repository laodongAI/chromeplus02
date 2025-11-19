import { getActiveTabId } from '../utils/chromeMessaging';
import { buildUnifiedMediaKey } from '../utils/mediaKeys';

export interface CapturedFrame {
  url: string; // data URL
  width: number;
  height: number;
  kind: 'frame' | 'tab-shot';
  timestamp: number;
  key?: string;
}

let timer: number | null = null;
let active = false;
let intervalMs = 5000;

export function isFrameCaptureActive(){ return active; }
export function getFrameIntervalSeconds(){ return Math.round(intervalMs/1000); }

export async function startFrameCapture(sec: number){
  stopFrameCapture();
  active = true;
  intervalMs = Math.max(1000, sec*1000);
  schedule();
}

export function stopFrameCapture(){
  active = false;
  if(timer){ clearTimeout(timer); timer = null; }
}

function schedule(){
  if(!active) return;
  timer = window.setTimeout(async ()=>{
    try {
      const frame = await captureOneFrame();
      if(frame){
        frame.key = buildUnifiedMediaKey(frame);
        dispatchFrame(frame);
      }
    } catch(e){ console.warn('[frameCapture] frame fail', e); }
    schedule();
  }, intervalMs);
}

async function captureOneFrame(): Promise<CapturedFrame | null>{
  try {
    const tabId = await getActiveTabId();
    if(!tabId) return null;
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const video = document.querySelector('video');
          if (video && (video as HTMLVideoElement).readyState >= 2) {
            const v = video as HTMLVideoElement;
            const w = v.videoWidth, h = v.videoHeight;
            if(w && h){
              const c = document.createElement('canvas');
              c.width = w; c.height = h;
              const ctx = c.getContext('2d');
              ctx!.drawImage(v,0,0,w,h);
              return { url: c.toDataURL('image/jpeg',0.9), width: w, height: h, kind:'frame', timestamp: Date.now() };
            }
          }
          // fallback capture visible tab screenshot
          return null;
        } catch { return null; }
      }
    });
    if(result) return result as CapturedFrame;
    // fallback visible tab
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab({ format:'jpeg', quality:80 });
      return { url: dataUrl, width: 0, height: 0, kind:'tab-shot', timestamp: Date.now() } as CapturedFrame;
    } catch { return null; }
  } catch(e){ return null; }
}

function dispatchFrame(frame: CapturedFrame){
  window.dispatchEvent(new CustomEvent('sidepanel:add-frame-image', { detail: frame }));
}
