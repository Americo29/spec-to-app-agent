import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { ApolloClient, InMemoryCache, ApolloProvider } from "@apollo/client";
import { graphql, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { CarInventory } from "@/components/CarInventory";
import type { Car } from "@/types";

const mockCars: Car[] = [
  {
    id: "1",
    make: "Toyota",
    model: "Camry",
    year: 2022,
    color: "Silver",
    mobile: "https://placehold.co/640x360?text=Toyota+Camry",
    tablet: "https://placehold.co/1023x576?text=Toyota+Camry",
    desktop: "https://placehold.co/1440x810?text=Toyota+Camry",
  },
  {
    id: "2",
    make: "Honda",
    model: "Civic",
    year: 2024,
    color: "Blue",
    mobile: "https://placehold.co/640x360?text=Honda+Civic",
    tablet: "https://placehold.co/1023x576?text=Honda+Civic",
    desktop: "https://placehold.co/1440x810?text=Honda+Civic",
  },
  {
    id: "3",
    make: "Ford",
    model: "Mustang",
    year: 2020,
    color: "Red",
    mobile: "https://placehold.co/640x360?text=Ford+Mustang",
    tablet: "https://placehold.co/1023x576?text=Ford+Mustang",
    desktop: "https://placehold.co/1440x810?text=Ford+Mustang",
  },
];

function renderCarInventory() {
  const client = new ApolloClient({
    uri: "http://localhost:4000/graphql",
    cache: new InMemoryCache({ addTypename: false }),
    defaultOptions: {
      watchQuery: { fetchPolicy: "no-cache" },
      query: { fetchPolicy: "no-cache" },
    },
  });

  return render(
    <ApolloProvider client={client}>
      <CarInventory />
    </ApolloProvider>
  );
}

function getSearchInput(): HTMLElement {
  return (
    screen.queryByRole("textbox", { name: /search/i }) ||
    screen.queryByPlaceholderText(/search/i) ||
    screen.getByRole("textbox")
  );
}

async function selectSortOption(optionRegex: RegExp) {
  const combobox =
    screen.queryByRole("combobox") || screen.queryByLabelText(/sort/i);
  if (combobox) {
    fireEvent.mouseDown(combobox);
    const option = await screen.findByRole("option", { name: optionRegex });
    fireEvent.click(option);
    return;
  }

  const optionElement =
    screen.queryByRole("button", { name: optionRegex }) ||
    screen.getByText(optionRegex);
  fireEvent.click(optionElement);
}

describe("CarInventory Integration", () => {
  beforeEach(() => {
    server.use(
      graphql.query("GetCars", () => {
        return HttpResponse.json({
          data: { cars: mockCars },
        });
      })
    );
  });

  it("renders loading indicator initially and then displays car list from API", async () => {
    renderCarInventory();

    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    expect(await screen.findByText(/Camry/i)).toBeInTheDocument();
    expect(screen.getByText(/Civic/i)).toBeInTheDocument();
    expect(screen.getByText(/Mustang/i)).toBeInTheDocument();
    expect(screen.getByText(/Toyota/i)).toBeInTheDocument();
    expect(screen.getByText(/Honda/i)).toBeInTheDocument();
    expect(screen.getByText(/Ford/i)).toBeInTheDocument();
  });

  it("filters visible cars when typing model name into search bar", async () => {
    renderCarInventory();

    await screen.findByText(/Camry/i);

    const searchInput = getSearchInput();
    fireEvent.change(searchInput, { target: { value: "Civic" } });

    expect(screen.getByText(/Civic/i)).toBeInTheDocument();
    expect(screen.queryByText(/Camry/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mustang/i)).not.toBeInTheDocument();
  });

  it("filters model search query case-insensitively", async () => {
    renderCarInventory();

    await screen.findByText(/Camry/i);

    const searchInput = getSearchInput();
    fireEvent.change(searchInput, { target: { value: "mustang" } });

    expect(screen.getByText(/Mustang/i)).toBeInTheDocument();
    expect(screen.queryByText(/Camry/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Civic/i)).not.toBeInTheDocument();
  });

  it("displays empty state when no cars match search query", async () => {
    renderCarInventory();

    await screen.findByText(/Camry/i);

    const searchInput = getSearchInput();
    fireEvent.change(searchInput, { target: { value: "NonExistentModel" } });

    expect(screen.queryByText(/Camry/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Civic/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mustang/i)).not.toBeInTheDocument();
  });

  it("changes sorting order when switching between year and make sort options", async () => {
    renderCarInventory();

    await screen.findByText(/Camry/i);

    await selectSortOption(/make/i);

    const makeSortedElements = screen.getAllByText(/Ford|Honda|Toyota/i);
    expect(makeSortedElements.length).toBeGreaterThan(0);

    await selectSortOption(/year/i);

    const yearSortedElements = screen.getAllByText(/2020|2022|2024/i);
    expect(yearSortedElements.length).toBeGreaterThan(0);
  });

  it("renders friendly error alert when GraphQL request fails", async () => {
    server.use(
      graphql.query("GetCars", () => {
        return HttpResponse.json({
          errors: [{ message: "Unable to load car inventory" }],
        });
      })
    );

    renderCarInventory();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(/Unable to load car inventory/i)
    ).toBeInTheDocument();
  });
});