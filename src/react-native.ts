// not using async to prevent [SyntaxError: 2:10969:async functions are unsupported] in react-native-webview
/* eslint-disable @typescript-eslint/promise-function-async */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { RefObject, useEffect, useRef } from 'react';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import { isObservable, Observable, Subscription } from 'rxjs';
import { serializeError } from 'serialize-error';
import {
  ApplyRequest,
  ApplySubscribeRequest,
  GetRequest,
  IWebViewPoseMessageCatData,
  ProxyDescriptor,
  Request,
  RequestType,
  ResponseType,
  SubscribeRequest,
  UnsubscribeRequest,
} from './common.js';
import { IpcProxyError, isFunction, webViewCallbackKey } from './utils.js';

// TODO: make it to be able to use @decorator, instead of write a description json. We can defer the setup of ipc handler to make this possible.
const registrations: Record<string, ProxyServerHandler | null> = {};

const exampleLogger = Object.assign(console, {
  emerg: console.error.bind(console),
  alert: console.error.bind(console),
  crit: console.error.bind(console),
  warning: console.warn.bind(console),
  notice: console.log.bind(console),
  debug: console.log.bind(console),
});

export function useRegisterProxy<T>(target: T, descriptor: ProxyDescriptor, logger?: typeof exampleLogger) {
  const webViewReference = useRef<WebView | null>(null);
  /**
   * [See issue 1829](https://github.com/react-native-webview/react-native-webview/issues/1829#issuecomment-1699235643), fixed by [You must set onMessage or the window.ReactNativeWebView.postMessage method will not be injected into the web page.](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Guide.md#the-windowreactnativewebviewpostmessage-method-and-onmessage-prop).
   */
  const onMessageReference = useRef<((event: WebViewMessageEvent) => void)>((event) => {
    console.log('WebView onMessage (before onMessageReference.current ready)', event);
  });
  useEffect(() => {
    if (webViewReference.current !== null) {
      const { onMessage, unregister } = registerProxy(target, descriptor, webViewReference, logger);
      onMessageReference.current = onMessage;
      return unregister;
    }
  }, [descriptor, logger, target]);
  return [webViewReference, onMessageReference] as const;
}

export function registerProxy<T>(target: T, descriptor: ProxyDescriptor, webViewReference: RefObject<WebView>, logger?: typeof exampleLogger): {
  onMessage: (event: WebViewMessageEvent) => void;
  unregister: () => void;
} {
  const { channel } = descriptor;

  if (registrations[channel] !== null && registrations[channel] !== undefined) {
    throw new IpcProxyError(`Proxy object has already been registered on channel ${channel}`);
  }

  const server = new ProxyServerHandler(target, webViewReference);
  registrations[channel] = server;

  const onMessage = (event: WebViewMessageEvent): void => {
    const dataString = event.nativeEvent.data;
    const { request, correlationId } = JSON.parse(dataString as string) as IWebViewPoseMessageCatData;
    server
      .handleRequest(request, channel)
      .then((result) => {
        server.sendDataToWebView(correlationId, channel, { type: ResponseType.Result, result });
      })
      .catch((error) => {
        let stringifiedRequest = '';
        try {
          stringifiedRequest = request === undefined ? '' : JSON.stringify(request);
        } catch {
          stringifiedRequest = request.type;
        }
        logger?.error?.(`E-0 IPC Error on ${channel} ${stringifiedRequest} ${(error as Error).message} ${(error as Error).stack ?? ''}`);
        server.sendDataToWebView(correlationId, channel, {
          type: ResponseType.Error,
          error: JSON.stringify(serializeError(error, { maxDepth: 1 })),
        });
      });
  };

  return {
    onMessage,
    unregister: () => {
      unregisterProxy(channel);
    },
  };
}

function unregisterProxy(channel: string): void {
  const server = registrations[channel];

  if (server === undefined) {
    throw new IpcProxyError(`No proxy is registered on channel ${channel}`);
  }
  server?.unsubscribeAll?.();
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete registrations[channel];
}

class ProxyServerHandler {
  constructor(private readonly target: any, private readonly webViewReference: RefObject<WebView>) {}

  private subscriptions: Record<string, Subscription | undefined> = {};

  public handleRequest(request: Request, channel: string): Promise<any> {
    switch (request.type) {
      case RequestType.Get: {
        return Promise.resolve(this.handleGet(request));
      }
      case RequestType.Apply: {
        return Promise.resolve(this.handleApply(request));
      }
      case RequestType.Subscribe: {
        this.handleSubscribe(request, channel);
        return Promise.resolve();
      }
      case RequestType.ApplySubscribe: {
        this.handleApplySubscribe(request, channel);
        return Promise.resolve();
      }
      case RequestType.Unsubscribe: {
        this.handleUnsubscribe(request);
        return Promise.resolve();
      }
      default: {
        throw new IpcProxyError(`Unhandled RequestType [${request.type}]`);
      }
    }
  }

  public unsubscribeAll(): void {
    Object.values(this.subscriptions).forEach((subscription) => subscription?.unsubscribe?.());
    this.subscriptions = {};
  }

  public sendDataToWebView(correlationId: string, channel: string, data: unknown) {
    const stringifiedData = JSON.stringify(data);
    const jsCode = `
      if (window["${webViewCallbackKey}"]?.trigger !== undefined) {
        window["${webViewCallbackKey}"].trigger("${correlationId}", "${channel}", ${stringifiedData});
      }
      true;
    `;
    this.webViewReference.current?.injectJavaScript(jsCode);
  }

  private handleGet(request: GetRequest): Promise<any> {
    return this.target[request.propKey];
  }

  private handleApply(request: ApplyRequest): any {
    const { propKey, args } = request;
    const function_ = this.target[propKey];

    if (!isFunction(function_)) {
      throw new IpcProxyError(`Remote property [${propKey}] is not a function`);
    }

    return function_.apply(this.target, args);
  }

  private handleSubscribe(request: SubscribeRequest, channel: string): void {
    const { propKey, subscriptionId } = request;
    const obs = this.target[propKey];

    if (!isObservable(obs)) {
      throw new IpcProxyError(`Remote property [${propKey}] is not an observable`);
    }
    if (typeof subscriptionId !== 'string') {
      // this will probably not happen
      throw new IpcProxyError(`subscriptionId [${subscriptionId as unknown as string}] is not a string`);
    }

    this.doSubscribe(obs, subscriptionId, channel);
  }

  private handleApplySubscribe(request: ApplySubscribeRequest, channel: string): void {
    const { propKey, subscriptionId, args } = request;
    const function_ = this.target[propKey];

    if (!isFunction(function_)) {
      throw new IpcProxyError(`Remote property [${propKey}] is not a function`);
    }

    const obs = function_.apply(this.target, args);

    if (!isObservable(obs)) {
      throw new IpcProxyError(`Remote function [${propKey}] did not return an observable`);
    }
    if (typeof subscriptionId !== 'string') {
      throw new IpcProxyError(`subscriptionId [${subscriptionId as unknown as string}] is not a string`);
    }

    this.doSubscribe(obs, subscriptionId, channel);
  }

  private doSubscribe(obs: Observable<unknown>, subscriptionId: string, channel: string): void {
    if (this.subscriptions[subscriptionId] !== undefined) {
      throw new IpcProxyError(`A subscription with Id [${subscriptionId}] already exists`);
    }

    this.subscriptions[subscriptionId] = obs.subscribe({
      next: (value) => {
        this.sendDataToWebView(subscriptionId, channel, { type: ResponseType.Next, value });
      },
      error: (error: Error) => {
        this.sendDataToWebView(subscriptionId, channel, { type: ResponseType.Error, error: JSON.stringify(serializeError(error, { maxDepth: 1 })) });
      },
      complete: () => {
        this.sendDataToWebView(subscriptionId, channel, { type: ResponseType.Complete });
      },
    });
  }

  private handleUnsubscribe(request: UnsubscribeRequest): void {
    const { subscriptionId } = request;

    if (this.subscriptions[subscriptionId] === undefined) {
      throw new IpcProxyError(`Subscription with Id [${subscriptionId}] does not exist`);
    }

    this.doUnsubscribe(subscriptionId);
  }

  private doUnsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions[subscriptionId];

    if (subscription !== undefined) {
      subscription.unsubscribe();
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this.subscriptions[subscriptionId];
    }
  }
}

export { ProxyPropertyType } from './common.js';
export { default as webviewPreloadedJS } from './webview-string.js';
