'use strict';

exports.postToolbarInit = (hookName, context) => {
  if (clientVars.ep_readonly_guest.isGuest) $('#myusernameedit').attr('disabled', true);
};
