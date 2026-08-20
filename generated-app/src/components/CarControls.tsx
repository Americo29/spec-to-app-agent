import {
  Box,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
} from "@mui/material";

export type SortBy = "year" | "make";

export interface CarControlsProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  sortBy: SortBy;
  onSortChange: (sortBy: SortBy) => void;
}

export function CarControls({
  searchTerm,
  onSearchChange,
  sortBy,
  onSortChange,
}: CarControlsProps) {
  const handleSortChange = (event: SelectChangeEvent<SortBy>) => {
    onSortChange(event.target.value as SortBy);
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        gap: 2,
        alignItems: { xs: "stretch", sm: "center" },
        mb: 3,
      }}
    >
      <TextField
        label="Search by model"
        variant="outlined"
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        fullWidth
        placeholder="Type a model name..."
        inputProps={{ "aria-label": "Search by model" }}
      />
      <FormControl sx={{ minWidth: 160 }}>
        <InputLabel id="sort-by-label">Sort By</InputLabel>
        <Select<SortBy>
          labelId="sort-by-label"
          id="sort-by-select"
          value={sortBy}
          label="Sort By"
          onChange={handleSortChange}
          aria-label="Sort by"
        >
          <MenuItem value="year">Year</MenuItem>
          <MenuItem value="make">Make</MenuItem>
        </Select>
      </FormControl>
    </Box>
  );
}

export default CarControls;