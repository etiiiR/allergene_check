FROM python:3.12.15-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    BERT_MODEL_NAME=prajjwal1/bert-tiny \
    BERT_MODEL_REVISION=6f75de8b60a9f8a2fdf7b69cbd86d9e64bcb3837 \
    BERT_DEVICE=cpu \
    CUDA_VISIBLE_DEVICES="" \
    HF_HOME=/models

WORKDIR /app

COPY requirements.lock ./
# Install the CPU-only wheel explicitly; the normal PyPI torch package can pull
# hundreds of megabytes of CUDA/NVIDIA runtime dependencies into this image.
RUN python -m pip install --no-cache-dir --require-hashes -r requirements.lock
RUN python -m nltk.downloader -d /usr/local/share/nltk_data stopwords
ENV NLTK_DATA=/usr/local/share/nltk_data

# Cache the small model in the image so runtime inference does not require model downloads.
RUN python -c "from transformers import AutoModel, AutoTokenizer; name='prajjwal1/bert-tiny'; revision='6f75de8b60a9f8a2fdf7b69cbd86d9e64bcb3837'; AutoTokenizer.from_pretrained(name, revision=revision); AutoModel.from_pretrained(name, revision=revision)"
RUN apt-get update \
    && apt-get install -y --no-install-recommends adduser \
    && addgroup --system --gid 10001 mlservice \
    && adduser --system --uid 10001 --ingroup mlservice --no-create-home mlservice \
    && rm -rf /var/lib/apt/lists/*
ENV BERT_LOCAL_FILES_ONLY=true \
    HF_HUB_OFFLINE=1 \
    HOME=/tmp

COPY app ./app

EXPOSE 8000
USER 10001:10001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
