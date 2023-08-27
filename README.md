# react-native-postmessage-cat

> Based on [linonetwo/electron-ipc-cat](https://github.com/linonetwo/electron-ipc-cat), and used in [TidGi-Mobile](https://github.com/tiddly-gittly/TidGi-Mobile]).

<p align="center" style="color: #343a40">
  <img src="docs/image/title-image.png" alt="electron-ipc-cat logo">
  <h1 align="center">react-native-postmessage-cat</h1>
</p>
<p align="center" style="font-size: 1.2rem;">Passing object and type between React Native main process and WebView process simply via proxy.</p>

## Overview

In latest react-native-webview, the `injectedJavaScriptBeforeContentLoaded` accepts stringified code, and you are required to passing data using postMessage. It requires tons of boilerplate code to build up this message bridge, just like the vanilla Redux.

Luckily we have frankwallis/electron-ipc-proxy which provide a good example about how to automatically build IPC channel for a class in the main process. But it doesn't work in react native, so here we have `react-native-postmessage-cat`!

We wrap our react native side class, and can use them from the `window.xxx` in the webview. All types are preserved, so you can get typescript intellisense just like using a local function.

## Install

```sh
pnpm i react-native-postmessage-cat
```

## Example

Real use case in [TidGi-Mobile's sync-adaptor](https://github.com/tiddly-gittly/TidGi-Mobile)

### 1. The class

```ts
/** workspaces.ts */
export class Workspace implements IWorkspaceService {
  /**
   * Record from workspace id to workspace settings
   */
  private workspaces: Record<string, IWorkspace> = {};
  public workspaces$: BehaviorSubject<Record<string, IWorkspace>>;

  public async getWorkspacesAsList(): Promise<IWorkspace[]> {
    return Object.values(this.workspaces).sort((a, b) => a.order - b.order);
  }

  public async get(id: string): Promise<IWorkspace | undefined> {
    return this.workspaces[id];
  }

  public get$(id: string): Observable<IWorkspace | undefined> {
    return this.workspaces$.pipe(map((workspaces) => workspaces[id]));
  }
}

export interface IWorkspaceService {
  workspaces$: BehaviorSubject<Record<string, IWorkspace>>;
  getWorkspacesAsList(): Promise<IWorkspace[]>;
  get(id: string): Promise<IWorkspace | undefined>;
  get$(id: string): Observable<IWorkspace | undefined>;
}

export const WorkspaceServiceIPCDescriptor = {
  channel: WorkspaceChannel.name,
  properties: {
    workspaces$: ProxyPropertyType.Value$,
    getWorkspacesAsList: ProxyPropertyType.Function,
    get: ProxyPropertyType.Function,
    get$: ProxyPropertyType.Function$,
  },
};
```

### 2. bindServiceAndProxy in React Native side & bridge proxy in preload script

```tsx
/**
 * Provide API from main services to WebView
 * This file should be required by BrowserView's preload script to work
 */
import { useMemo } from 'react';
import webviewPreloadedJS from 'react-native-postmessage-cat/webview-string';
import { useRegisterProxy } from 'react-native-postmessage-cat/react-native';

import { WorkspaceServiceIPCDescriptor } from '@services/workspaces/interface';

const workspaceService = new WorkspaceService();

export const WikiViewer = () => {
  const [webViewReference] = useRegisterProxy(workspaceService, WorkspaceServiceIPCDescriptor)
  const preloadScript = useMemo(() =>`
    ${webviewPreloadedJS}
    true; // note: this is required, or you'll sometimes get silent failures
  `, []);
  return (
    <WebViewContainer>
      <WebView
        source={{ html: wikiHTMLString }}
        onMessage={onMessage}
        ref={webViewReference}
        injectedJavaScriptBeforeContentLoaded={runFirst}
      />
    </WebViewContainer>
  );
};
```

### 4. receive in JS that runs inside WebView

```ts
/** renderer.tsx */
import 'react-native-postmessage-cat/fixContextIsolation';


import { IWorkspace } from '@services/workspaces';
import { WorkspaceServiceIPCDescriptor } from '@services/workspaces/interface';

// `window.PostMessageCat`'s type is same as `createProxy` in `'react-native-postmessage-cat/webview'`
const workspaceService = window.PostMessageCat<IWorkspace>(WorkspaceServiceIPCDescriptor)

export function useWorkspacesListObservable(): IWorkspace[] | undefined {
  const [workspaces, workspacesSetter] = useState<IWorkspace[] | undefined>();
  // beware not pipe directly in the react hock, as it will re-pipe every time React reRenders, and every time regarded as new Observable, so it will re-subscribe
  // useMemo will solve this
  const workspacesList$ = useMemo(
    () => workspaceService.workspaces$.pipe(map<Record<string, IWorkspace>, IWorkspace[]>((workspaces) => Object.values(workspaces))),
    [],
  );
  useObservable<IWorkspace[] | undefined>(workspacesList$, workspacesSetter);
  return workspaces;
}

export function useWorkspaceObservable(id: string): IWorkspace | undefined {
  const [workspace, workspaceSetter] = useState<IWorkspace | undefined>();
  const workspace$ = useMemo(() => workspaceService.get$(id), [id]);
  useObservable<IWorkspace | undefined>(workspace$, workspaceSetter);
  return workspace;
}
```

## Notes

All `Values` and `Functions` will return promises on the renderer side, no matter how they have been defined on the source object. This is because communication happens asynchronously. For this reason it is recommended that you make them promises on the source object as well, so the interface is the same on both sides.

Use `Value$` and `Function$` when you want to expose or return an Observable stream across IPC.

Only plain objects can be passed between the 2 sides of the proxy, as the data is serialized to JSON, so no functions or prototypes will make it across to the other side.

Notice the second parameter of `createProxy` - `Observable` this is done so that the library itself does not need to take on a dependency to rxjs. You need to pass in the Observable constructor yourself if you want to consume Observable streams.

The channel specified must be unique and match on both sides of the proxy.

The packages exposes 2 entry points in the "main" and "browser" fields of package.json. "main" is for the main thread and "browser" is for the renderer thread.

## See it working

[Example in TiddlyGit](https://github.com/tiddly-gittly/TiddlyGit-Desktop/blob/0c6b26c0c1113e0c66d6f49f022c5733d4fa85e8/src/preload/common/services.ts#L27-L42)

## FAQ

### reject string

You should reject an Error, other wise `serialize-error` can't handle it well.

```diff
- reject(errorMessage);
+ reject(new Error(errorMessage));
```

## Change Log
