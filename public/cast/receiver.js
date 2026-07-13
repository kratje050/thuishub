const context=cast.framework.CastReceiverContext.getInstance();
const player=context.getPlayerManager();
player.setMessageInterceptor(cast.framework.messages.MessageType.LOAD,request=>{const data=request.media&&request.media.customData||{};if(data.source!=='ThuisHub')throw new Error('Alleen beveiligde ThuisHub-media is toegestaan.');return request;});
player.addEventListener(cast.framework.events.EventType.ERROR,event=>console.error('ThuisHub receiver-fout',event&&event.detailedErrorCode));
context.start({disableIdleTimeout:false,maxInactivity:3600});
