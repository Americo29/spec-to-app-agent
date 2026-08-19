import { useState, useMemo } from "react";
import {
  Box,
  Container,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Typography,
  CircularProgress,
  Alert,
  SelectChangeEvent,
} from "@mui/material";
import { useCars } from "@/hooks/useCars";
import { CarCard } from "@/components/CarCard";

type SortOption = "make" | "year";

export function CarInventory() {
  const { cars, loading, error } = useCars();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("make");

  const filteredCars = useMemo(() => {
    if (!searchQuery.trim()) return cars;
    const query = searchQuery.toLowerCase().trim();
    return cars.filter((car) => car.model.toLowerCase().includes(query));
  }, [cars, searchQuery]);

  const sortedCars = useMemo(() => {
    return [...filteredCars].sort((a, b) => {
      if (sortBy === "make") {
        return a.make.localeCompare(b.make);
      }
      if (sortBy === "year") {
        return a.year - b.year;
      }
      return 0;
    });
  }, [filteredCars, sortBy]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box py={4}>
        <Alert severity="error">
          {error.message || "Failed to load car inventory."}
        </Alert>
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom align="center" sx={{ mb: 4 }}>
        Car Inventory
      </Typography>

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          gap: 2,
          mb: 4,
          alignItems: "center",
        }}
      >
        <TextField
          fullWidth
          label="Search by model"
          variant="outlined"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Type to filter by model..."
        />
        <FormControl sx={{ minWidth: 160, width: { xs: "100%", sm: "auto" } }}>
          <InputLabel id="sort-by-label">Sort By</InputLabel>
          <Select
            labelId="sort-by-label"
            id="sort-by-select"
            value={sortBy}
            label="Sort By"
            onChange={(e: SelectChangeEvent<SortOption>) =>
              setSortBy(e.target.value as SortOption)
            }
          >
            <MenuItem value="make">Make</MenuItem>
            <MenuItem value="year">Year</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {sortedCars.length === 0 ? (
        <Box textAlign="center" py={4}>
          <Typography variant="h6" color="text.secondary">
            No cars found matching your search criteria.
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={3}>
          {sortedCars.map((car) => (
            <Grid item key={car.id} xs={12} sm={6} md={4}>
              <CarCard car={car} />
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
}

export default CarInventory;