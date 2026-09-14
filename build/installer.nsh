; The app registers the native messaging host itself on first run, which is what covers macOS, Linux
; and a development run where there is no installer at all. This exists so a fresh Windows install
; works before Nixie has ever been opened, and so an uninstall leaves no registry key behind pointing
; at a manifest that is gone. The manifest file itself is written by the app into
; $APPDATA\Nixie\native-host on first run, so the value below may name a file that does not exist yet:
; Chromium treats that exactly as an unregistered host, and the first run makes it real.
;
; Keep this list in step with BROWSERS in electron/native-host-register.ts. Keep perMachine false (the
; default): an elevated install would write these into the administrator's hive rather than the user's.

!macro customInstall
  StrCpy $0 "$APPDATA\Nixie\native-host\com.theedoran.nixie.json"
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.theedoran.nixie" "" "$0"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.theedoran.nixie" "" "$0"
  WriteRegStr HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.theedoran.nixie" "" "$0"
  WriteRegStr HKCU "Software\Vivaldi\NativeMessagingHosts\com.theedoran.nixie" "" "$0"
  WriteRegStr HKCU "Software\Chromium\NativeMessagingHosts\com.theedoran.nixie" "" "$0"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.theedoran.nixie"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.theedoran.nixie"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.theedoran.nixie"
  DeleteRegKey HKCU "Software\Vivaldi\NativeMessagingHosts\com.theedoran.nixie"
  DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\com.theedoran.nixie"
  ; The wrapper and the config carry the pipe token, so they go with the uninstall even though the
  ; rest of userData stays.
  RMDir /r "$APPDATA\Nixie\native-host"
!macroend
