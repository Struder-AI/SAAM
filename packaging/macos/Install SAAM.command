#!/bin/bash
# Finder opens .command files in Terminal. Keep failures visible there.
here="$(cd "$(dirname "$0")" && pwd)" || exit 1
printf '\033]0;Install SAAM\007'
if [ ! -f "$here/app.tar" ] || [ ! -f "$here/app/packaging/macos/install.sh" ]; then
  echo 'Part of the package is missing. Extract the whole ZIP, then double-click Install SAAM.command inside the extracted folder.'
  status=1
else
  /bin/bash "$here/app/packaging/macos/install.sh"
  status=$?
fi
echo
if [ "$status" -ne 0 ]; then echo 'SAAM was not installed. The error is shown above.'; fi
read -r -p 'Press Return to finish. ' _
exit "$status"
