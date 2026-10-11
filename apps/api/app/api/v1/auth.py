from fastapi import APIRouter, Depends

from app.core.auth import CurrentAdmin, require_admin

router = APIRouter()


@router.get("/me")
def me(admin: CurrentAdmin = Depends(require_admin)) -> dict[str, str]:
    return {"id": str(admin.id), "email": admin.email, "role": admin.role}
