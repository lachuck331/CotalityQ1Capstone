# Aggregated Project Metrics

Because the trained models and final generation datasets are too large for GitHub, they are hosted on Hugging Face:
🔗 **[Tuned XGboost Final Prediction Dataset (Hugging Face)](https://huggingface.co/datasets/gwuwong/cotality-capstone)**

Below is a consolidated summary of the model evaluation metrics extracted from the local Jupyter Notebook experiments. Due to extreme spatial class imbalance (wildfire events are exceptionally rare), **PR-AUC** (Precision-Recall Area Under Curve) and **ROC-AUC** are the primary metrics of interest, rather than raw accuracy.

## Quarter 1: San Diego Prototype (`q1_sd_models.ipynb`)
Initial local models tested on the San Diego County subset.

| Model Variant | Test Accuracy | ROC-AUC | PR-AUC |
|---|---|---|---|
| Baseline Classifiers | 84.00% | 0.9287 | 0.0154 |
| SVM / Linear Base | 99.90% | 0.5325 | 0.0061 |
| XGBoost (SD Target) | 99.90% | 0.9114 | **0.0468** |

## Quarter 2: California Statewide Baseline (`ca_baseline.ipynb`)
Scaling up to the full California state spatial domain using traditional algorithms.

| Model Variant | Split | Accuracy | ROC-AUC | PR-AUC |
|---|---|---|---|---|
| Logistic Regression | Test | 74.66% | 0.8703 | 0.0063 |
| Random Forest | Test | 99.93% | 0.8112 | 0.0020 |
| Best Baseline | Validation | 72.67% | 0.8652 | 0.0035 |

## Quarter 2: California XGBoost (`ca_xgboost.ipynb`)
Final hyperparameter-tuned classification using GPU-accelerated XGBoost over the CA domain.

| Split | Accuracy | ROC-AUC | PR-AUC |
|---|---|---|---|
| **Test** | 99.95% | **0.9448** | **0.5548** |
| **Validation** | 99.94% | **0.8425** | **0.0113** |

### Key Takeaways
- **XGBoost vastly out-performs traditional baselines**, particularly measured by PR-AUC, highlighting its ability to rank positive fire events correctly in the highly imbalanced dataset.
- The drop in PR-AUC from Test (0.55) to Validation (0.01) on the California model emphasizes the extreme difficulty of generalizing rare spatial boundary events to future, unseen climate configurations.
