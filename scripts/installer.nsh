!macro customUnInstall
  nsExec::Exec 'schtasks /delete /tn "AdeoReminders" /f'
!macroend
