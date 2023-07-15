from django.db import models
from jalali_date import datetime2jalali, date2jalali
from django.core.validators import MaxLengthValidator
from accounts.models import User

# ----------------------- General Models  -----------------------
class General(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='تاریخ ایجاد')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='تاریخ ویرایش')

    class Meta:
        abstract = True

    def get_created_at(self):
        return datetime2jalali(self.created_at).strftime('%H:%M - %Y/%m/%d')
    get_created_at.short_description = 'تاریخ ایجاد'

    def get_updated_at(self):
        return datetime2jalali(self.updated_at).strftime('%H:%M - %Y/%m/%d')
    get_updated_at.short_description = 'آخرین بروزرسانی'
# ----------------------- end General Models  -----------------------


class UserStatus(User):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='status')
    online = models.BooleanField(default=False)

    def is_online(self):
        return True if self.online else False



class ChatRoom(General):
    name = models.CharField(max_length=100)

    def __str__(self):
        return self.name
    

class Message(General):
    chat_room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE)
    sender = models.ForeignKey(User, on_delete=models.CASCADE)
    message = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)


    def __str__(self):
        return self.message

    def add_seen_user(self, user):
        self.seen_by.add(user)

    