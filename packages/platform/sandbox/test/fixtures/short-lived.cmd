@rem Starts one short-lived process after another, until it is ended.
@for /L %%i in (1,1,1000000) do @cmd /d /c exit
