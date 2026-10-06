"""Contact route: `POST /contact`.

The response never carries the Visitor's input back, and a message is not
linked to a Visit. Delivery by email runs after the response is sent.
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app.data.contact_repo import ContactStorageError
from app.deps import ClientDep, ContactServiceDep
from app.services.contact import RATE_LIMIT_WINDOW_SECONDS, NewMessage, RateLimitedError

router = APIRouter(tags=["contact"])


class MessageReceived(BaseModel):
    """The answer to a message, the same whether it was stored or not."""

    received: bool = True


@router.post("/contact", status_code=201, response_model=MessageReceived)
async def send_message(
    body: NewMessage,
    background: BackgroundTasks,
    service: ContactServiceDep,
    client: ClientDep,
) -> MessageReceived:
    """Store a contact message and email it to Ali when mail is set up.

    A filled honeypot gets this same answer and nothing is stored.
    """
    try:
        message_id = await service.submit(body, client)
    except RateLimitedError:
        raise HTTPException(
            status_code=429,
            detail="Too many messages from this connection. Try again in an hour.",
            headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
        ) from None
    except ContactStorageError:
        raise HTTPException(
            status_code=503, detail="The message could not be saved."
        ) from None
    if message_id is not None:
        background.add_task(service.deliver, message_id, body)
    return MessageReceived()
