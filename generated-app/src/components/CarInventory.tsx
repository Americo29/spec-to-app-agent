import { useState, useMemo } from "react";
import { Box, CircularProgress, Alert, Grid, Typography } from "@mui/material";
import { useCars } from "@/hooks/useCars";
import { CarCard } from "@/components/CarCard";
import { CarControls, SortBy } from "@/components/CarControls";

export function CarInventory() {
  const { cars, loading, error } = useCars();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("year");

  const filteredAndSortedCars = useMemo(() => {
    return cars
      .filter((car) =>
        car.model.toLowerCase().includes(searchTerm.toLowerCase().trim())
      )
      .sort((a, b) => {
        if (sortBy === "year") {
          return b.year - a.year;
        }
        return a.make.localeCompare(b.make);
      });
  }, [cars, searchTerm, sortBy]);

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="200px"
        data-testid="loading-spinner"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ my: 2 }}>
        {error.message || "Failed to load car inventory. Please try again later."}
      </Alert>
    );
  }

  return (
    <Box sx={{ py: 3 }}>
      <CarControls
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        sortBy={sortBy}
        onSortChange={setSortBy}
      />

      {filteredAndSortedCars.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <Typography variant="h6" color="text.secondary">
            No cars found matching "{searchTerm}"
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={3}>
          {filteredAndSortedCars.map((car) => (
            <Grid item key={car.id} xs={12} sm={6} md={4}>
              <CarCard car={car} />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}

export default CarInventory;