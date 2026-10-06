"""Answers to invalid contact input: one message per field, never the input."""

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

CONTACT_PATH = "/api/v1/contact"
_FIELDS = ("name", "email", "message")
_LABELS = {"name": "your name", "email": "your email address", "message": "a message"}


async def validation_error_handler(request: Request, exc: Exception) -> Response:
    """Answer 422 with `errors`, a message per field, for the contact route.

    FastAPI's default answer echoes each rejected value under `input`; for a
    contact message that would send the Visitor's text back and invite it into
    logs, so this route's answer carries only our own messages. Other routes
    keep the default.
    """
    if not isinstance(exc, RequestValidationError):
        raise exc
    if request.url.path != CONTACT_PATH:
        return await request_validation_exception_handler(request, exc)
    errors: dict[str, str] = {}
    for error in exc.errors():
        location = error.get("loc", ())
        field = next((part for part in location if part in _FIELDS), None)
        if field is None or field in errors:
            continue
        if error["type"] == "value_error":
            errors[field] = str(error["msg"]).removeprefix("Value error, ")
        else:
            errors[field] = f"Enter {_LABELS[field]}."
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder(
            {"detail": "Some fields need attention.", "errors": errors}
        ),
    )
