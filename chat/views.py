from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse_lazy
from .models import ChatRoom, Message
from django.views.generic import View, UpdateView
from .forms import CreateChatRoomForm
from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin
from accounts.models import User



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



def room(request, room_name):
    chat_room = get_object_or_404(ChatRoom, name=room_name)
    chat_messages = Message.objects.filter(chat_room=chat_room)

    context = {
        'room_name': room_name,
        'chat_messages': chat_messages,
        'current_user': request.user.username
    }


    return render(request, 'chat/chat_room.html', context)




class CreateChatRoomView(LoginRequiredMixin, View):
    template_name = 'chat/index.html'
    form_class = CreateChatRoomForm
    

    def get(self, request, *args, **kwargs):
        chat_rooms = get_chat_rooms_with_last_message()
        form = self.form_class()
        return render(request, self.template_name, {'form': form, 'chat_rooms': chat_rooms})

    
    def post(self, request, *args, **kwargs):
        chat_rooms = get_chat_rooms_with_last_message()
        form = self.form_class(request.POST)
        if form.is_valid():
            room_name = form.cleaned_data['name']
            chat_room, created = ChatRoom.objects.get_or_create(name=room_name)
            return redirect('chat:room', room_name)
        return render(request, self.template_name, {'form': form, 'chat_rooms': chat_rooms, 'room_name': room_name})


