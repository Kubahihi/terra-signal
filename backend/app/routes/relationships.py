from fastapi import APIRouter

from ..relationship_schemas import RelationshipRequest, RelationshipResponse
from ..services.relationships import analyze_relationship


router = APIRouter(prefix="/api", tags=["Descriptive relationships"])


@router.post("/relationships", response_model=RelationshipResponse)
def relationships(request: RelationshipRequest) -> RelationshipResponse:
    """Analyze caller-supplied monthly observations; no provider download or refetch."""
    return analyze_relationship(request)
