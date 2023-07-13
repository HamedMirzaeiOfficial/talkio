from django.shortcuts import render, redirect
from .models import ChatRoom, Message


def get_chat_rooms_with_last_message():
    chat_rooms = ChatRoom.objects.all()
    chat_rooms_with_last_message = []

    for room in chat_rooms:
        last_message = Message.objects.filter(chat_room=room).order_by('-timestamp').first() 

        chat_rooms_with_last_message.append({
            'id': room.id, 
            'room_name': room.name, 
            'last_message': {
                'message': last_message.message if last_message else None, 
                'timestamp': last_message.timestamp if last_message else None, 
                'sender': last_message.sender.username if last_message and last_message.sender else None
            }
        })

        return chat_rooms_with_last_message



def index(request):
    user = request.user
    if not user.is_authenticated:
        return redirect('accounts:login')
    
    chat_rooms = get_chat_rooms_with_last_message()

    return render(request, 'chat/index.html', {'chat_rooms': chat_rooms})


def room(request, room_name):
    chat_room, created = ChatRoom.objects.get_or_create(name=room_name)
    chat_messages = Message.objects.filter(chat_room=chat_room)

    context = {
        'room_name': room_name, 
        'chat_messages': chat_messages, 
        'current_user': request.user.username
    }

    return render(request, 'chat/chat_room.html', context)
