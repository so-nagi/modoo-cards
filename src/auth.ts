import { useSyncExternalStore } from 'react';
import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut as firebaseSignOut, type Auth, type User } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { SessionBoundary } from './session';
import { apiURL } from './backend';

export type AppConfig = { authMode: 'local' | 'firebase' | 'unconfigured'; firebase: FirebaseOptions | null; engineVersion: string };
type Profile = { displayName: string | null; email: string | null; photoURL: string | null; uid: string };
type State = { user: Profile | null; config: AppConfig | null; loading: boolean; error: string | null; ready: boolean };
let state: State = { user: null, config: null, loading: true, error: null, ready: false };
let auth: Auth | null = null;
let cloud: Firestore | null = null;
let currentUser: User | null = null;
let initialization: Promise<void> | null = null;
const listeners = new Set<() => void>();
export const sessionBoundary = new SessionBoundary();
const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
function friendlyAuthError(error: unknown) {
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    'auth/popup-closed-by-user': '로그인 창이 닫혔어요. 다시 시도할 수 있어요.',
    'auth/cancelled-popup-request': '진행 중인 로그인 창을 확인해 주세요.',
    'auth/unauthorized-domain': '이 주소가 Google 로그인 허용 도메인에 등록되지 않았어요.',
    'auth/operation-not-allowed': 'Firebase에서 Google 로그인 제공자를 활성화해야 해요.',
    'auth/network-request-failed': '네트워크 연결을 확인한 뒤 다시 로그인해 주세요.',
  };
  return code && messages[code] || '로그인 연결을 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}

async function initialize() {
  try {
    const response = await fetch(apiURL('/config'), { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('앱 서버에 연결하지 못했어요. 실행 상태를 확인해 주세요.');
    const config: AppConfig = await response.json();
    publish({ config });
    if (config.authMode === 'local') {
      sessionBoundary.set('local');
      publish({ ready: true, loading: false });
      return;
    }
    if (config.authMode !== 'firebase' || !config.firebase?.projectId) {
      publish({ loading: false, error: 'Google 로그인 연결 설정이 필요해요. 서버의 Firebase 설정을 확인해 주세요.' });
      return;
    }
    const app = initializeApp(config.firebase);
    auth = getAuth(app);
    cloud = getFirestore(app);
    onIdTokenChanged(auth, user => {
      currentUser = user;
      sessionBoundary.set(user?.uid ?? null);
      publish({
        user: user ? { uid: user.uid, displayName: user.displayName, email: user.email, photoURL: user.photoURL } : null,
        loading: false, ready: !!user, error: null,
      });
    }, error => publish({ loading: false, ready: false, error: friendlyAuthError(error) }));
    await getRedirectResult(auth);
  } catch (error) {
    publish({ loading: false, ready: false, error: error instanceof Error ? error.message : '앱을 준비하지 못했어요.' });
  }
}

export async function signIn() {
  if (!auth) { publish({ error: 'Google 로그인 설정이 아직 준비되지 않았어요.' }); return; }
  publish({ error: null });
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { await signInWithPopup(auth, provider); }
  catch (error) {
    if ((error as { code?: string }).code === 'auth/popup-blocked') await signInWithRedirect(auth, provider);
    else publish({ error: friendlyAuthError(error) });
  }
}

export async function signOut() {
  sessionBoundary.set(null);
  currentUser = null;
  publish({ user: null, ready: false, error: null });
  if (auth) await firebaseSignOut(auth);
  if (state.config?.authMode === 'local') {
    sessionBoundary.set('local');
    publish({ ready: true });
  }
}

export async function requestIdentity() {
  const generation = sessionBoundary.capture();
  if (state.config?.authMode === 'local') return { generation, token: null, uid: 'local' };
  if (!currentUser) throw new Error('Google 계정으로 로그인해 주세요.');
  const uid = currentUser.uid;
  const token = await currentUser.getIdToken();
  sessionBoundary.assertCurrent(generation);
  return { generation, token, uid };
}

export async function cloudSettingsRead(): Promise<Record<string, unknown> | null> {
  if (!cloud || !currentUser) return null;
  const generation = sessionBoundary.capture();
  const snapshot = await getDoc(doc(cloud, 'users', currentUser.uid, 'settings', 'ui'));
  sessionBoundary.assertCurrent(generation);
  return snapshot.exists() ? snapshot.data() : null;
}

export async function cloudSettingsWrite(settings: Record<string, unknown>) {
  if (!cloud || !currentUser) return;
  const generation = sessionBoundary.capture();
  const reference = doc(cloud, 'users', currentUser.uid, 'settings', 'ui');
  await setDoc(reference, settings, { merge: true });
  sessionBoundary.assertCurrent(generation);
}

export function useAuth() {
  if (!initialization) initialization = initialize();
  const snapshot = useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
    () => state,
  );
  return { ...snapshot, signIn, signOut };
}
