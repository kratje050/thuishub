!macro customInstall
  Delete "$DESKTOP\Huiskamer.lnk"
  Delete "$SMPROGRAMS\Huiskamer.lnk"
  RMDir "$SMPROGRAMS\Huiskamer"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION "Wil je ook alle ThuisHub-gebruikersgegevens, instellingen en back-ups verwijderen? Kies Nee om je gegevens te behouden." /SD IDNO IDNO keepUserData
    RMDir /r "$APPDATA\ThuisHub"
    keepUserData:
  ${endIf}
!macroend
