/*
Known Issues/Limitations:
- can only return max 640 characters, for now limit verses to 5 at once but ideally split messages up
- User.map check for first time may expire too quickly, and at any rate should eventually be stored/moved to db side

Bugs:
*/

/*
To Do:
Build in message parser for handling > 640 characters
*/

//1.0 App init, configs check, custom helper functions, and dependency requirements
//2.0 Connection with mySQL database
//3.0 Endpoint handling- currently implemented with facebook messenger integration
    //3.1 Verify incoming request came from facebook
    //3.2 Setup infastructure to recieve facebook messages and indicate when typing
    //3.3 Process recieved message/request
        //3.3.1 Recognize we've recieved message- recievedMessage(Type)
        //3.3.2 Send user's message to API.ai- sendToApiAi(senderID, messageText)
        //3.3.3 Process API.ai response- handleApiAiResponse(sender, response)



        //handleApiAiResponse(sender, response) - response from Api has returned
            //if more complex than text routes to handle message
        //sendTextMessage(sender, responseText) - pass response along to FB API call
        //callSendAPI(messageData) - make the FB api call


    //3.3 Check if user exists or if first time user
    //3.4
    //3.2 Process incoming message from user
        //3.2.1 In some cases, route to DB search
        //3.2.2 At same time (parallel) pass inquiry to API.ai
    //3.3 API.ai returns its response to user input

//1.0 Init app, setup JSON parsing, check for configs and require dependencies
    'use strict';
    //Require modules
    const apiai = require('apiai');
    const express = require("express");
    const crypto = require('crypto');
    const bodyParser = require('body-parser');
    const request = require('request');
    const uuid = require('uuid');
    const app = express();

    //Require other files
    const config = require('./config');
    // const database = require('./database');

    // Process application/x-www-form-urlencoded
    app.use(bodyParser.urlencoded({
        extended: false
    }))

    // Process application/json
    app.use(bodyParser.json())

    //serve public files
    app.use(express.static('public'));


    // Messenger API parameters
    if (!config.FB_PAGE_TOKEN) {
        throw new Error('missing FB_PAGE_TOKEN');
    }
    if (!config.FB_VERIFY_TOKEN) {
        throw new Error('missing FB_VERIFY_TOKEN');
    }
    if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
        throw new Error('missing API_AI_CLIENT_ACCESS_TOKEN');
    }
    if (!config.FB_APP_SECRET) {
        throw new Error('missing FB_APP_SECRET');
    }
    if (!config.SERVER_URL) { //used for serving public files
        throw new Error('missing SERVER_URL');
    }

    //Helper functions
    function isDefined(obj) {
        if (typeof obj == 'undefined') {
            return false;
        }

        if (!obj) {
            return false;
        }

        return obj != null;
    }

//2.0 Connect with mySQL database

    //See database.js

//3.0 Endpoint handling
    //3.1 Verify incoming request from facebook
        app.use(bodyParser.json({
            verify: verifyRequestSignature
        }));

        // Facebook verification endpoint
        app.get('/webhook/', function (req, res) {
            console.log('hit webook: ', req, res)
            if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
                console.log('facebook verified')
                res.status(200).send(req.query['hub.challenge']);
            } else {
                console.log('facebook not verified')
                console.error("Failed validation. Make sure the validation tokens match.");
                res.sendStatus(403);
            }
        })

        function verifyRequestSignature(req, res, buf) {
            var signature = req.headers["x-hub-signature"];

            if (!signature) {
                throw new Error('Couldn\'t validate the signature.');
            } else {
                var elements = signature.split('=');
                var method = elements[0];
                var signatureHash = elements[1];

                var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
                    .update(buf)
                    .digest('hex');

                if (signatureHash != expectedHash) {
                    throw new Error("Couldn't validate the request signature.");
                }
            }
        }
    //3.2 Setup infastructure to recieve facebook messages

        //Init API.ai object, as well as maps for users and sessions
        const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
            language: "en",
            requestSource: "fb"
        });
        const sessionIds = new Map();
        const usersMap = new Map();

        //Setup index route
        app.get('/', function (req, res) {
            res.send('You can find Mindtank on Facebook Messenger')
        })

        //Post to webhook to catch messages
        app.post('/webhook/', function (req, res) {
            console.log('post hit webhook')
            var data = req.body;

            // Make sure this is a page subscription
            if (data.object == 'page') {
                // Iterate over each entry
                // There may be multiple if batched
                data.entry.forEach(function (pageEntry) {
                    var pageID = pageEntry.id;
                    var timeOfEvent = pageEntry.time;

                    // Iterate over each type of messaging event
                    pageEntry.messaging.forEach(function (messagingEvent) {
                        //Case 1- Authentication - Note it appears in FB documentation this has been deprecated/is a subset of account linking
                        if (messagingEvent.optin) {
                            receivedAuthentication(messagingEvent);
                        }
                        //Case 2- Recieve a message - HANDLED
                        else if (messagingEvent.message) {
                            console.log('recieved message: ', messagingEvent.message)
                            receivedMessage(messagingEvent);
                        }
                        //Catch all
                        else {
                            console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                        }
                    });
                });
                //Facebook requires returning a 200 status
                res.sendStatus(200);
            }
        });

        //'Typing on' and 'typing off' messages show Messenger typing icon while we are processing response
        function sendTypingOn(recipientId) {
            // console.log("TYPING TURNING ON");

            var messageData = {
                recipient: {
                    id: recipientId
                },
                sender_action: "typing_on"
            };

            // callSendAPI(messageData);
            queueRequest(messageData)
        }

        function sendTypingOff(recipientId) {
            // console.log("TYPING TURNING OFF");

            var messageData = {
                recipient: {
                    id: recipientId
                },
                sender_action: "typing_off"
            };

            // callSendAPI(messageData);
            queueRequest(messageData)
        }

    //3.3 Process received message/request
        //3.3.1 Recognize we've recieved message and check if user is first time user


            function receivedMessage(event) {

                sendTypingOn(event.sender.id);

                var callback = function(event, firstTimeUser){
                    var senderID = event.sender.id;
                    var recipientID = event.recipient.id;
                    var timeOfMessage = event.timestamp;
                    var message = event.message;

                    var isEcho = message.is_echo;
                    var messageId = message.mid;
                    var appId = message.app_id;
                    var metadata = message.metadata;

                    // Message can be a text or attachment but not both at same time (FB splits)
                    var messageText = message.text;
                    var messageAttachments = message.attachments;
                    var quickReply = message.quick_reply;

                    if (isEcho) {
                        // Ignore echos
                        return;
                    } else if (firstTimeUser) {
                        //circumvent going to Api.AI and just return a direct call
                        //var firstName = usersMap.get(senderID).first_name
                        sendTextMessage(senderID, `Hi, welcome to Mind Tank.`)
                        sendTypingOn(senderID)
                        sendTextMessage(senderID, `I can help you chat with the world's brightest minds. For now you can chat with my friend, Albert Einstein.`)
                    } else if (quickReply) {
                        // ignore quickreplies for now
                        return;
                    } else if (messageText) {
                        // Pass message along to API.ai
                        sendToApiAi(senderID, messageText);
                    } else if (messageAttachments) {
                        // ignore attachments for now
                    }
                }
                //Set session and user, and trigger response function only one has completed (implemented as callback so usercheck can be done locally or migrated to db)
                setSessionAndUser(event, callback);
            }

            //Function to set sessionID (required by API.ai) and user ID (for our own records)
            function setSessionAndUser(event, callback) {
                console.log('setting sessions and user 1')
                var senderID = event.sender.id;
                var firstTimeUser = false
                if (!sessionIds.has(senderID)) {
                    sessionIds.set(senderID, uuid.v1());
                    console.log('setting sessions and user 2')
                }
                //Not perfect, should hit database for check
                if (!usersMap.has(senderID)) {
                    console.log('setting sessions and user 3')
                    firstTimeUser = true
                    usersMap.set(senderID, senderID)
                    // database.userData( function (user) {
                    //     usersMap.set(senderID, user);
                    //     callback(event, firstTimeUser)
                    // }, senderID);
                    callback(event, firstTimeUser)
                } else{
                    callback(event, firstTimeUser)
                }
            }

        //3.3.2 Send user's message to API.ai

            function sendToApiAi(sender, text) {

                let apiaiRequest = apiAiService.textRequest(text, {
                    sessionId: sessionIds.get(sender)
                });

                apiaiRequest.on('response', (response) => {
                    if (isDefined(response.result)) {
                        handleApiAiResponse(sender, response);
                    }
                });

                apiaiRequest.on('error', (error) => console.error(error));
                apiaiRequest.end();
            }

        //3.3.3 Process API.ai response

        function handleApiAiResponse(sender, response) {
            let responseText = response.result.fulfillment.speech;
            let responseData = response.result.fulfillment.data;
            let messages = response.result.fulfillment.messages;
            let action = response.result.action;
            let contexts = response.result.contexts;
            let parameters = response.result.parameters;

            // messages is an array, iterate through and check if strings are > max FB 640 character limit
            //messages[i].speech must be less than 640 characters

            //Build custom responses to API.ai actions here
            // if (action === ""){
            // }
            //Default Response
            sendTextMessage(sender, responseText);
        }

        function sendTextMessage(recipientId, text) {
            var messageData = {
                recipient: {
                    id: recipientId
                },
                message: {
                    //Note that this must be less than 640 characters
                    text: text
                }
            }
            // callSendAPI(messageData);
            console.log('sender is:', sender)
            sendTypingOn(sender.id);
            queueRequest(messageData);
        }


        //FB Bug: https://developers.facebook.com/bugs/565416400306038
        //http://stackoverflow.com/questions/37152355/facebook-messenger-bot-not-sending-messages-in-order
        //IMPLEMENTING QUEUE HERE AS SOLUTION
        var queue = [];
        var queueProcessing = false;

        function queueRequest(request) {
            queue.push(request);
            if (queueProcessing) {
                return;
            }
            queueProcessing = true;

            processQueue();
        }

        function processQueue() {
            if (queue.length == 0) {
                queueProcessing = false;
                return;
            }
            var currentRequest = queue.shift();

            var delay = 0
            if (isDefined(currentRequest.message)){
                if (isDefined(currentRequest.message.text)){
                    //in seconds
                    delay = 1000 * currentRequest.message.text.length / config.TYPING_DELAY_SCALE
                    console.log('DELAY IS: ', delay)
                }
            }

            setTimeout(function(){

                console.log('MAKING QUEUE REQUEST')
                request({
                    uri: 'https://graph.facebook.com/v2.6/me/messages',
                    qs: {
                        access_token: config.FB_PAGE_TOKEN
                    },
                    method: 'POST',
                    json: currentRequest
                }, function (error, response, body) {
                    if (!error && response.statusCode == 200) {
                        var recipientId = body.recipient_id;
                        var messageId = body.message_id;

                        if (messageId) {
                            // console.log("Successfully sent message with id %s to recipient %s",
                            //     messageId, recipientId);
                            console.log('Message delivered to FB')
                            processQueue();
                        } else {
                            // console.log("Successfully called Send API for recipient %s",
                            //     recipientId);
                            processQueue();
                        }
                    } else {
                        console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
                    }
                })
            }, delay)
        }


//Launch server
var port = process.env.PORT || 3000;
app.listen(port, function() {
    console.log("Listening on " + port);
});