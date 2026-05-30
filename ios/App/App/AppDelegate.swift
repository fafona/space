import UIKit
import Capacitor
import WebKit
import Photos

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, WKScriptMessageHandler {

    var window: UIWindow?
    private let launchBackgroundColor = UIColor(red: 8.0 / 255.0, green: 17.0 / 255.0, blue: 33.0 / 255.0, alpha: 1.0)
    private var launchCover: UIView?
    private var launchCoverFallbackWorkItem: DispatchWorkItem?
    private var launchBridgeInstalled = false

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        window?.backgroundColor = launchBackgroundColor
        window?.rootViewController?.view.backgroundColor = launchBackgroundColor
        installNativeLaunchCoverIfPossible()
        installNativeLaunchBridgeIfPossible()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        DispatchQueue.main.async {
            self.installNativeLaunchBridgeIfPossible()
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    private func installNativeLaunchCoverIfPossible(retryCount: Int = 0) {
        guard let window = window else {
            retryInstallLaunchCover(retryCount: retryCount)
            return
        }
        if launchCover != nil {
            if let cover = launchCover {
                cover.superview?.bringSubviewToFront(cover)
            }
            scheduleNativeLaunchCoverFallback()
            return
        }

        window.backgroundColor = launchBackgroundColor
        window.rootViewController?.view.backgroundColor = launchBackgroundColor

        let cover = UIView(frame: window.bounds)
        cover.backgroundColor = launchBackgroundColor
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.isUserInteractionEnabled = true

        let imageView = UIImageView(frame: cover.bounds)
        imageView.backgroundColor = launchBackgroundColor
        imageView.image = UIImage(named: "Splash")
        imageView.contentMode = .scaleAspectFill
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.addSubview(imageView)

        window.addSubview(cover)
        launchCover = cover
        scheduleNativeLaunchCoverFallback()
    }

    private func retryInstallLaunchCover(retryCount: Int) {
        guard retryCount < 20 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            self.installNativeLaunchCoverIfPossible(retryCount: retryCount + 1)
        }
    }

    private func showNativeLaunchCover() {
        installNativeLaunchCoverIfPossible()
        guard let cover = launchCover else { return }
        cover.layer.removeAllAnimations()
        cover.alpha = 1.0
        cover.isHidden = false
        cover.superview?.bringSubviewToFront(cover)
        scheduleNativeLaunchCoverFallback()
    }

    private func hideNativeLaunchCover() {
        launchCoverFallbackWorkItem?.cancel()
        launchCoverFallbackWorkItem = nil
        guard let cover = launchCover else { return }
        UIView.animate(
            withDuration: 0.16,
            delay: 0,
            options: [.beginFromCurrentState, .curveEaseOut],
            animations: {
                cover.alpha = 0.0
            },
            completion: { _ in
                if self.launchCover === cover {
                    self.launchCover = nil
                }
                cover.removeFromSuperview()
            }
        )
    }

    private func scheduleNativeLaunchCoverFallback() {
        launchCoverFallbackWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            self?.hideNativeLaunchCover()
        }
        launchCoverFallbackWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 60.0, execute: workItem)
    }

    private func installNativeLaunchBridgeIfPossible(retryCount: Int = 0) {
        guard let bridgeViewController = window?.rootViewController as? CAPBridgeViewController,
              let webView = bridgeViewController.webView else {
            guard retryCount < 30 else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self.installNativeLaunchBridgeIfPossible(retryCount: retryCount + 1)
            }
            return
        }

        webView.isOpaque = false
        webView.backgroundColor = launchBackgroundColor
        webView.scrollView.isOpaque = false
        webView.scrollView.backgroundColor = launchBackgroundColor

        guard !launchBridgeInstalled else { return }
        let source = """
        (() => {
          if (window.__faollaIosLaunchBridgeInstalled) return;
          window.__faollaIosLaunchBridgeInstalled = true;
          const post = (action, payload) => {
            try {
              window.webkit &&
                window.webkit.messageHandlers &&
                window.webkit.messageHandlers.faollaNativeUpdates &&
                window.webkit.messageHandlers.faollaNativeUpdates.postMessage(Object.assign({ action }, payload || {}));
            } catch (_) {}
          };
          const galleryCallbacks = {};
          window.__faollaNativeResolveGallerySave = (requestId, ok, message) => {
            const callback = galleryCallbacks[requestId];
            if (!callback) return;
            delete galleryCallbacks[requestId];
            callback({ ok: ok === true, message: typeof message === "string" ? message : "" });
          };
          const previous = window.FaollaNativeUpdates || {};
          window.FaollaNativeUpdates = Object.assign({}, previous, {
            hideLaunchCover: () => {
              try {
                if (previous && typeof previous.hideLaunchCover === "function") previous.hideLaunchCover();
              } catch (_) {}
              post("hideLaunchCover");
            },
            showLaunchCover: () => {
              try {
                if (previous && typeof previous.showLaunchCover === "function") previous.showLaunchCover();
              } catch (_) {}
              post("showLaunchCover");
            },
            saveImageToGallery: (payload) => new Promise((resolve) => {
              const requestId = `gallery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              galleryCallbacks[requestId] = resolve;
              post("saveImageToGallery", { requestId, payload });
              setTimeout(() => {
                if (!galleryCallbacks[requestId]) return;
                delete galleryCallbacks[requestId];
                resolve({ ok: false, message: "gallery_save_timeout" });
              }, 12000);
            })
          });
        })();
        """
        let userContentController = webView.configuration.userContentController
        userContentController.add(self, name: "faollaNativeUpdates")
        userContentController.addUserScript(
            WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        webView.evaluateJavaScript(source, completionHandler: nil)
        launchBridgeInstalled = true
    }

    private func resolveGallerySaveRequest(_ requestId: String, ok: Bool, message: String) {
        guard let bridgeViewController = window?.rootViewController as? CAPBridgeViewController,
              let webView = bridgeViewController.webView else {
            return
        }
        let args: String
        if let data = try? JSONSerialization.data(withJSONObject: [requestId, ok, message], options: []),
           let encoded = String(data: data, encoding: .utf8) {
            args = encoded
        } else {
            args = "[\"\",false,\"gallery_save_failed\"]"
        }
        DispatchQueue.main.async {
            webView.evaluateJavaScript(
                "window.__faollaNativeResolveGallerySave && window.__faollaNativeResolveGallerySave.apply(window, \(args));",
                completionHandler: nil
            )
        }
    }

    private func saveImageToGallery(payloadJson: String, requestId: String) {
        guard let payloadData = payloadJson.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
              let rawDataUrl = payload["dataUrl"] as? String else {
            resolveGallerySaveRequest(requestId, ok: false, message: "图片数据为空")
            return
        }
        let base64 = rawDataUrl.split(separator: ",", maxSplits: 1).last.map(String.init) ?? rawDataUrl
        guard let imageData = Data(base64Encoded: base64),
              let image = UIImage(data: imageData) else {
            resolveGallerySaveRequest(requestId, ok: false, message: "图片数据为空")
            return
        }

        let saveChanges = {
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }) { success, error in
                self.resolveGallerySaveRequest(
                    requestId,
                    ok: success,
                    message: success ? "已保存至相册" : (error?.localizedDescription ?? "相册保存失败")
                )
            }
        }

        if #available(iOS 14, *) {
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                if status == .authorized || status == .limited {
                    saveChanges()
                } else {
                    self.resolveGallerySaveRequest(requestId, ok: false, message: "没有相册写入权限")
                }
            }
        } else {
            PHPhotoLibrary.requestAuthorization { status in
                if status == .authorized {
                    saveChanges()
                } else {
                    self.resolveGallerySaveRequest(requestId, ok: false, message: "没有相册写入权限")
                }
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "faollaNativeUpdates",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            return
        }

        DispatchQueue.main.async {
            if action == "hideLaunchCover" {
                self.hideNativeLaunchCover()
            } else if action == "showLaunchCover" {
                self.showNativeLaunchCover()
            } else if action == "saveImageToGallery" {
                let requestId = body["requestId"] as? String ?? ""
                let payload = body["payload"] as? String ?? ""
                self.saveImageToGallery(payloadJson: payload, requestId: requestId)
            }
        }
    }

}
