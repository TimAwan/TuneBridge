export interface MusicKitHandle {
  authorize(): Promise<void>;
  musicUserToken(): string;
}

interface MusicKitInstanceLike {
  authorize(): Promise<void>;
  musicUserToken: string;
}

interface MusicKitGlobal {
  configure(opts: { developerToken: string; build?: string }): Promise<MusicKitInstanceLike>;
}

let handle: MusicKitHandle | null = null;

function loadScript(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector('script[data-musickit]')) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://js-cdn.music.apple.com/musickit/v3/dist/index.js';
    script.setAttribute('data-musickit', '');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('无法加载 MusicKit JS,请检查网络'));
    document.head.appendChild(script);
  });
}

export async function loadMusicKit(developerToken: string): Promise<MusicKitHandle> {
  if (handle) return handle;
  await loadScript();
  const MusicKit = (window as unknown as { MusicKit?: MusicKitGlobal }).MusicKit;
  if (!MusicKit) throw new Error('MusicKit JS 未就绪');
  const instance = await MusicKit.configure({ developerToken, build: 'v3' });
  handle = {
    authorize: () => instance.authorize(),
    musicUserToken: () => instance.musicUserToken,
  };
  return handle;
}
