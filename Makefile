.PHONY: test install clean download_q1 process_q1 all_q1 download_q2 process_q2 all_q2

# Default Python executable
PYTHON = python3

# Run all unit tests
test:
	pytest tests/ -v

# Install project dependencies
install:
	pip install -e .

# Quarter 1 (San Diego) Data Pipeline
download_q1:
	cd data_processing/quarter_1 && \
	$(PYTHON) download_sd_county.py && \
	$(PYTHON) download_prism_data.py && \
	$(PYTHON) download_nlcd_annual.py

process_q1:
	cd data_processing/quarter_1 && \
	$(PYTHON) process_dem_data.py && \
	$(PYTHON) process_ndvi_data.py && \
	$(PYTHON) process_mtbs_data.py && \
	$(PYTHON) combine_dataset.py

all_q1: download_q1 process_q1

# Quarter 2 (California Statewide) Data Pipeline
download_q2:
	cd data_processing/quarter_2 && \
	$(PYTHON) download_ca_state.py && \
	$(PYTHON) download_prism_data.py && \
	$(PYTHON) download_nlcd_annual.py

process_q2:
	cd data_processing/quarter_2 && \
	$(PYTHON) process_dem_data.py && \
	$(PYTHON) process_ndvi_data.py && \
	$(PYTHON) process_mbts_data.py && \
	$(PYTHON) combine_dataset.py

all_q2: download_q2 process_q2

# Clean temporary files and caches
clean:
	rm -rf tests/__pycache__
	rm -rf data_processing/quarter_1/__pycache__
	rm -rf data_processing/quarter_2/__pycache__
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
