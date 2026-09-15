FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    BERT_MODEL_NAME=prajjwal1/bert-tiny \
    BERT_DEVICE=cpu \
    CUDA_VISIBLE_DEVICES="" \
    HF_HOME=/models

WORKDIR /app

COPY requirements.txt requirements-cpu.txt ./
# Install the CPU-only wheel explicitly; the normal PyPI torch package can pull
# hundreds of megabytes of CUDA/NVIDIA runtime dependencies into this image.
RUN pip install --no-cache-dir -r requirements-cpu.txt
RUN python -m nltk.downloader -d /usr/local/share/nltk_data stopwords
ENV NLTK_DATA=/usr/local/share/nltk_data

# Cache the small model in the image so runtime inference does not require model downloads.
RUN python -c "from transformers import AutoModel, AutoTokenizer; name='prajjwal1/bert-tiny'; AutoTokenizer.from_pretrained(name); AutoModel.from_pretrained(name)"

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
