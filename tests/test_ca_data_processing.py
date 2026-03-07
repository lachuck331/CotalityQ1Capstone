import pytest
import polar as pl
from pathlib import Path
import os
import sys

# Add the quarter_2 data processing dir to path to import it
sys.path.append(str(Path(__file__).resolve().parent.parent / "data_processing" / "quarter_2"))

from combine_dataset import ensure_temp_dir, cleanup_temp_dir, TEMP_DIR

def test_ca_ensure_temp_dir():
    """Verify that ensure_temp_dir correctly provisions the temporary processing directory for CA."""
    cleanup_temp_dir()
    assert not TEMP_DIR.exists(), "Temp dir should not exist before ensuring"
    
    ensure_temp_dir()
    assert TEMP_DIR.exists(), "Temp dir should be created"
    assert TEMP_DIR.is_dir(), "Temp path should be a directory"

def test_ca_cleanup_temp_dir():
    """Verify that cleanup_temp_dir removes the temporary processing directory for CA."""
    ensure_temp_dir()
    assert TEMP_DIR.exists(), "Temp dir should exist before cleaning"
    
    cleanup_temp_dir()
    assert not TEMP_DIR.exists(), "Temp dir should be successfully removed"

def test_ca_delete_files(tmp_path):
    """Verify delete_files correctly removes files when provided a list."""
    from combine_dataset import delete_files
    
    f1 = tmp_path / "ca_dummy1.txt"
    f2 = tmp_path / "ca_dummy2.txt"
    f1.touch()
    f2.touch()
    
    assert f1.exists() and f2.exists()
    
    delete_files([f1, f2])
    
    assert not f1.exists()
    assert not f2.exists()
