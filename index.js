'use strict';

const $ = require('cheerio');
const log4js = require('ep_etherpad-lite/node_modules/log4js');
const plugins = require('ep_etherpad-lite/static/js/pluginfw/plugin_defs');

const pluginName = 'ep_guest';
const logger = log4js.getLogger(pluginName);
let user;

const endpoint = (ep) => `/${encodeURIComponent(pluginName)}/${ep}`;

const makeLogInOutButton = (req) => {
  const {user: {username} = {}} = req.session;
  const isGuest = username === user.username;
  const ep = isGuest ? 'login' : 'logout';
  const buttonUri = `${endpoint(ep)}?redirect_uri=${encodeURIComponent(req.url)}`;
  const buttonText = isGuest ? 'Log In' : 'Log Out';
  return $('<div>')
      .addClass('btn-container')
      .append($('<a>')
          .attr('href', buttonUri)
          .addClass('btn')
          .addClass('btn-primary')
          .attr('data-l10n-id', `${pluginName}_${ep}`)
          .text(buttonText));
};

exports.authenticate = (hookName, {req}, cb) => {
  logger.debug(`${hookName} ${req.url}`);
  // If the user is visiting the 'forceauth' endpoint then fall through to the next authenticate
  // plugin (or to the built-in basic auth). This is what forces the real authentication.
  if (req.path === endpoint('forceauth')) return cb([]);
  req.session.user = user;
  return cb([true]);
};

exports.eejsBlock_permissionDenied = (hookName, context) => {
  logger.debug(hookName);
  // Load the HTML into a throwaway div instead of calling $.load() to avoid
  // https://github.com/cheeriojs/cheerio/issues/1031
  const content = $('<div>').html(context.content);
  content.find('#permissionDenied').prepend(
      makeLogInOutButton(context.renderContext.req)
          .css('float', 'right')
          .css('padding', '10px'));
  context.content = content.html();
};

exports.eejsBlock_userlist = (hookName, context) => {
  logger.debug(hookName);
  // Load the HTML into a throwaway div instead of calling $.load() to avoid
  // https://github.com/cheeriojs/cheerio/issues/1031
  const content = $('<div>').html(context.content);
  content.find('#myuser').append(
      makeLogInOutButton(context.renderContext.req).css('margin-left', '10px'));
  context.content = content.html();
};

// Note: The expressCreateServer hook is executed after plugins have been loaded, including after
// installing a plugin from the admin page.
exports.expressCreateServer = (hookName, {app}) => {
  logger.debug(hookName);
  // Make sure this plugin's authenticate function is called before any other plugin's authenticate
  // function, otherwise users will not be able to visit pads as the guest user.
  plugins.hooks.authenticate.sort((a, b) => a.part.name === pluginName ? -1 : 0);
  // Login is handled by two endpoints:
  //   1. The 'login' endpoint destroys the Express session state and redirects the user to the
  //      'forceauth' endpoint.
  //   2. The 'forceauth' endpoint forces the user to authenticate with Etherpad, then redirects the
  //      user back to wherever they came from. (How this works: This plugin's authenticate function
  //      defers the authn decision if the user visits the 'forcelogin' endpoint, which causes
  //      Etherpad to fall back to the next authenticate plugin or to the built-in HTTP basic auth
  //      if there is no other authn plugin.)
  // Endpoint #1 is only needed if the user is already logged in as guest (or another user). These
  // steps cannot be combined in a single handler because the Express route needs to restart from
  // the beginning after the session is destroyed. I couldn't find a good way to do that other than
  // to force the user to visit a different URL.
  app.get(endpoint('login'), (req, res, next) => {
    (async () => {
      logger.debug(req.url);
      // Use a relative URL when redirecting to the 'forceauth' endpoint in case the reverse proxy
      // is configured to offset the Etherpad paths (e.g., /etherpad/p/foo instead of /p/foo).
      const epAndQuery = req.url.split('/').slice(-1)[0].split('?');
      epAndQuery[0] = 'forceauth';
      req.session.destroy(() => res.redirect(epAndQuery.join('?')));
    })().catch(next);
  });
  app.get(endpoint('forceauth'), (req, res, next) => {
    logger.debug(req.url);
    res.redirect(req.query.redirect_uri || '..');
  });
  app.get(endpoint('logout'), (req, res, next) => {
    logger.debug(req.url);
    req.session.destroy(() => res.redirect(req.query.redirect_uri || '..'));
  });
};

exports.loadSettings = async (hookName, {settings}) => {
  logger.debug(hookName);
  if (settings[pluginName] == null) settings[pluginName] = {};
  const s = settings[pluginName];
  s.username = s.username || 'guest';
  user = settings.users[s.username];
  if (user == null) {
    user = settings.users[s.username] = {
      displayname: 'Read-Only Guest',
      displaynameChangeable: false,
      readOnly: true,
    };
  }
  user.username = s.username;
};

exports.preAuthorize = (hookName, {req}, cb) => {
  // Don't bother logging the user in as guest if they're simply visiting the 'login' endpoint.
  if (req.path === endpoint('login')) return cb([true]);
  return cb([]);
};
