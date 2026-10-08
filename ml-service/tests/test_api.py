import os

import pytest
from fastapi.testclient import TestClient

from app.main import BERT_LOCAL_FILES_ONLY, BERT_MODEL_REVISION, app


client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "ml"
    assert body["bert_model"] == "prajjwal1/bert-tiny"
    assert body["bert_revision"] == BERT_MODEL_REVISION
    assert body["bert_local_files_only"] == BERT_LOCAL_FILES_ONLY
    assert body["bert_device"] == "cpu"
    assert body["bert_loaded"] is False


def test_linear_regression_fit_and_predict():
    response = client.post(
        "/ml/linear-regression",
        json={
            "features": [[1], [2], [3], [4]],
            "target": [3, 5, 7, 9],
            "predict": [[5], [6]],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "linear_regression"
    assert body["predictions"] == [11.0, 13.0]
    assert body["r2"] == 1.0


def test_logistic_regression_fit_and_predict():
    response = client.post(
        "/ml/logistic-regression",
        json={
            "features": [[0], [1], [2], [3]],
            "target": [0, 0, 1, 1],
            "predict": [[0.1], [2.9]],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "logistic_regression"
    assert body["classes"] == [0, 1]
    assert body["predictions"] == [0, 1]


def test_rejects_ragged_features():
    response = client.post(
        "/ml/linear-regression",
        json={"features": [[1, 2], [3]], "target": [1, 2]},
    )

    assert response.status_code == 422


def test_nltk_text_similarity():
    response = client.post(
        "/nlp/text-similarity",
        json={
            "text_a": "The allergen warning is important.",
            "text_b": "An important allergen warning.",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["common_tokens"] == ["allergen", "import", "warn"]
    assert body["jaccard_similarity"] == 1.0


def test_nltk_text_similarity_rejects_empty_text():
    response = client.post(
        "/nlp/text-similarity",
        json={"text_a": "", "text_b": "some text"},
    )

    assert response.status_code == 422


@pytest.mark.skipif(os.getenv("RUN_BERT_TESTS") != "1", reason="set RUN_BERT_TESTS=1 to load the BERT model")
def test_bert_similarity_is_cpu_only():
    response = client.post(
        "/nlp/bert-similarity",
        json={
            "text_a": "The allergen warning is important.",
            "text_b": "The allergen warning is important.",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["device"] == "cpu"
    assert body["embedding_dimension"] == 128
    assert body["cosine_similarity"] > 0.99
