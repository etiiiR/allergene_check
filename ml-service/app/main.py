"""Small stateless ML and NLP API for regression and text similarity."""

import os
import threading
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from nltk.corpus import stopwords
from nltk.stem import PorterStemmer
from nltk.tokenize import wordpunct_tokenize
from pydantic import BaseModel, Field, model_validator
from sklearn.linear_model import LinearRegression, LogisticRegression
import torch
from transformers import AutoModel, AutoTokenizer
from app.diary_analysis import router as diary_router


BERT_MODEL_NAME = os.getenv("BERT_MODEL_NAME", "prajjwal1/bert-tiny")
BERT_DEVICE = torch.device("cpu")
torch.set_num_threads(int(os.getenv("TORCH_NUM_THREADS", "1")))

_bert_lock = threading.Lock()
_bert_tokenizer = None
_bert_model = None
_stemmer = PorterStemmer()
try:
    _stop_words = set(stopwords.words("english"))
except LookupError:
    # Keep local development usable when the optional NLTK corpus is not downloaded.
    _stop_words = {"a", "an", "and", "are", "as", "at", "be", "by", "for", "in", "is", "it", "of", "on", "or", "the", "to"}


app = FastAPI(
    title="Fiber ML Service",
    version="0.1.0",
    description="Basic regression and CPU-only text similarity over JSON data.",
)
app.include_router(diary_router)


class FeatureRequest(BaseModel):
    """Shared training data contract for tabular models."""

    features: List[List[float]] = Field(..., min_length=2)
    predict: Optional[List[List[float]]] = None

    @model_validator(mode="after")
    def validate_feature_matrix(self):
        if not self.features or not self.features[0]:
            raise ValueError("features must contain at least one column")

        width = len(self.features[0])
        if any(len(row) != width for row in self.features):
            raise ValueError("features must be a rectangular matrix")

        if self.predict is not None and any(len(row) != width for row in self.predict):
            raise ValueError("predict rows must have the same number of columns as features")

        return self


class LinearRegressionRequest(FeatureRequest):
    """Training data for ordinary least-squares linear regression."""

    target: List[float] = Field(..., min_length=2)

    @model_validator(mode="after")
    def validate_target_length(self):
        if len(self.target) != len(self.features):
            raise ValueError("target must contain one value per feature row")
        return self


class LogisticRegressionRequest(FeatureRequest):
    """Training data and solver settings for logistic classification."""

    target: List[int] = Field(..., min_length=2)
    max_iter: int = Field(default=1000, ge=100, le=10000)

    @model_validator(mode="after")
    def validate_target_length(self):
        if len(self.target) != len(self.features):
            raise ValueError("target must contain one value per feature row")
        return self


class LinearRegressionResponse(BaseModel):
    """Fitted linear model parameters and optional predictions."""

    model: str
    coefficients: List[float]
    intercept: float
    r2: float
    predictions: Optional[List[float]] = None


class LogisticRegressionResponse(BaseModel):
    """Fitted logistic model parameters, metrics, and optional predictions."""

    model: str
    coefficients: List[List[float]]
    intercepts: List[float]
    classes: List[int]
    accuracy: float
    predictions: Optional[List[int]] = None
    probabilities: Optional[List[List[float]]] = None


class TextSimilarityRequest(BaseModel):
    """Two texts and normalization settings for lexical similarity analysis."""

    text_a: str = Field(..., min_length=1, max_length=10000)
    text_b: str = Field(..., min_length=1, max_length=10000)
    remove_stopwords: bool = True
    stem: bool = True


class TextSimilarityResponse(BaseModel):
    """Explainable token overlap metrics produced by NLTK preprocessing."""

    tokens_a: List[str]
    tokens_b: List[str]
    common_tokens: List[str]
    jaccard_similarity: float
    overlap_coefficient: float


class BertSimilarityRequest(BaseModel):
    """Two texts for semantic similarity using the tiny CPU BERT encoder."""

    text_a: str = Field(..., min_length=1, max_length=10000)
    text_b: str = Field(..., min_length=1, max_length=10000)


class BertSimilarityResponse(BaseModel):
    """Cosine similarity from the normalized mean-pooled BERT embeddings."""

    model: str
    device: str
    embedding_dimension: int
    cosine_similarity: float


@app.get("/health")
def health():
    """Return service liveness for Docker Compose and orchestration checks."""

    return {
        "status": "ok",
        "service": "ml",
        "bert_model": BERT_MODEL_NAME,
        "bert_device": str(BERT_DEVICE),
        "bert_loaded": _bert_model is not None,
    }


def _normalized_tokens(text: str, remove_stopwords: bool, stem: bool) -> List[str]:
    """Tokenize text with NLTK and optionally remove stopwords and stem words."""

    tokens = []
    for token in wordpunct_tokenize(text.lower()):
        if not any(character.isalnum() for character in token):
            continue
        if remove_stopwords and token in _stop_words:
            continue
        tokens.append(_stemmer.stem(token) if stem else token)
    return tokens


def _cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    """Return cosine similarity while safely handling zero-length vectors."""

    left_norm = np.linalg.norm(left)
    right_norm = np.linalg.norm(right)
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return float(np.dot(left, right) / (left_norm * right_norm))


def _load_bert():
    """Load the tiny BERT tokenizer/model once and pin inference to CPU."""

    global _bert_model, _bert_tokenizer
    if _bert_model is not None and _bert_tokenizer is not None:
        return _bert_tokenizer, _bert_model

    with _bert_lock:
        if _bert_model is None or _bert_tokenizer is None:
            _bert_tokenizer = AutoTokenizer.from_pretrained(BERT_MODEL_NAME)
            _bert_model = AutoModel.from_pretrained(BERT_MODEL_NAME)
            _bert_model.to(BERT_DEVICE)
            _bert_model.eval()
    return _bert_tokenizer, _bert_model


def _bert_embedding(text: str) -> np.ndarray:
    """Create a normalized mean-pooled CPU embedding for one text."""

    tokenizer, model = _load_bert()
    encoded = tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        max_length=256,
    )
    encoded = {key: value.to(BERT_DEVICE) for key, value in encoded.items()}
    with torch.inference_mode():
        output = model(**encoded)
        attention_mask = encoded["attention_mask"].unsqueeze(-1).expand(output.last_hidden_state.size()).float()
        pooled = (output.last_hidden_state * attention_mask).sum(dim=1) / attention_mask.sum(dim=1).clamp(min=1e-9)
        normalized = torch.nn.functional.normalize(pooled, p=2, dim=1)
    return normalized[0].cpu().numpy()


@app.post("/ml/linear-regression", response_model=LinearRegressionResponse)
def fit_linear_regression(request: LinearRegressionRequest):
    """Fit linear regression and optionally predict on a second feature matrix."""

    x_train = np.asarray(request.features, dtype=float)
    y_train = np.asarray(request.target, dtype=float)
    model = LinearRegression().fit(x_train, y_train)

    predictions = None
    if request.predict is not None:
        predictions = model.predict(np.asarray(request.predict, dtype=float)).tolist()

    return LinearRegressionResponse(
        model="linear_regression",
        coefficients=model.coef_.tolist(),
        intercept=float(model.intercept_),
        r2=float(model.score(x_train, y_train)),
        predictions=predictions,
    )


@app.post("/ml/logistic-regression", response_model=LogisticRegressionResponse)
def fit_logistic_regression(request: LogisticRegressionRequest):
    """Fit logistic regression and optionally return class probabilities."""

    if len(set(request.target)) < 2:
        raise HTTPException(status_code=422, detail="target must contain at least two classes")

    x_train = np.asarray(request.features, dtype=float)
    y_train = np.asarray(request.target, dtype=int)
    model = LogisticRegression(max_iter=request.max_iter).fit(x_train, y_train)

    predictions = None
    probabilities = None
    if request.predict is not None:
        x_predict = np.asarray(request.predict, dtype=float)
        predictions = model.predict(x_predict).astype(int).tolist()
        probabilities = model.predict_proba(x_predict).tolist()

    return LogisticRegressionResponse(
        model="logistic_regression",
        coefficients=model.coef_.tolist(),
        intercepts=model.intercept_.tolist(),
        classes=model.classes_.astype(int).tolist(),
        accuracy=float(model.score(x_train, y_train)),
        predictions=predictions,
        probabilities=probabilities,
    )


@app.post("/nlp/text-similarity", response_model=TextSimilarityResponse)
def text_similarity(request: TextSimilarityRequest):
    """Analyze explainable lexical overlap using NLTK tokenization and stemming."""

    tokens_a = _normalized_tokens(request.text_a, request.remove_stopwords, request.stem)
    tokens_b = _normalized_tokens(request.text_b, request.remove_stopwords, request.stem)
    set_a = set(tokens_a)
    set_b = set(tokens_b)
    common_tokens = sorted(set_a & set_b)
    union = set_a | set_b
    smaller_set_size = min(len(set_a), len(set_b))

    jaccard = len(set_a & set_b) / len(union) if union else 1.0
    overlap = len(set_a & set_b) / smaller_set_size if smaller_set_size else 1.0 if set_a == set_b else 0.0

    return TextSimilarityResponse(
        tokens_a=tokens_a,
        tokens_b=tokens_b,
        common_tokens=common_tokens,
        jaccard_similarity=float(jaccard),
        overlap_coefficient=float(overlap),
    )


@app.post("/nlp/bert-similarity", response_model=BertSimilarityResponse)
def bert_similarity(request: BertSimilarityRequest):
    """Compare two texts with the lazy-loaded, CPU-only tiny BERT encoder."""

    try:
        embedding_a = _bert_embedding(request.text_a)
        embedding_b = _bert_embedding(request.text_b)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="BERT model is unavailable") from exc

    return BertSimilarityResponse(
        model=BERT_MODEL_NAME,
        device=str(BERT_DEVICE),
        embedding_dimension=int(embedding_a.shape[0]),
        cosine_similarity=_cosine_similarity(embedding_a, embedding_b),
    )
