/* global TrelloPowerUp */

var Promise = TrelloPowerUp.Promise;

TrelloPowerUp.initialize({
  'card-buttons': function(t, opts) {
    return Promise.join(
      t.get('organization', 'private', 'token'),
      t.get('board', 'private', 'token'))
    .spread(function(orgToken, boardToken){
      return boardToken || orgToken;
    })
    .then(function(token){
      return [{
        icon: 'https://cdn.hyperdev.com/07656aca-9ccd-4ad1-823c-dbd039f7fccc%2Fzzz-grey.svg',
        text: 'Click Me',
        callback: function(context) {
          if (!token) {
            context.popup({
              title: 'Authorize Your Account',
              url: './auth.html',
              height: 75
            });
          } else {
            return context.popup({
              title: 'You are authed!',
              url: './already-authed.html',
              height: 75
            });
          }
        }
      }];
    });
  }
});